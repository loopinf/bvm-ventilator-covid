import 'react-native-gesture-handler';
import React, { Component } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Appbar } from 'react-native-paper';
import {
  StyleSheet,
  View,
  NativeEventEmitter,
  NativeModules,
  Platform,
  PermissionsAndroid,
  AppState,
  ActivityIndicator,
} from 'react-native';
import BleManager from 'react-native-ble-manager';
import difference from 'lodash.difference';
import { stringToBytes } from 'convert-string';

import ScreenContainer from './components/ScreenContainer';
import ChartsScreen from './screens/ChartsScreen';
import SettingsScreen from './screens/SettingsScreen';

import { decode } from './utils/utf8Convertor';
import {
  DEVICE_UUID,
  SERVICE_UUID_SETTINGS,
  SERVICE_UUID_SENSORS,
  CHARACTERISTIC_UUID_SETTINGS,
  CHARACTERISTIC_UUID_SENSORS,
} from './constants/bleUUIDs';
import findPeripheral from './utils/findPeripheral';

const BleManagerModule = NativeModules.BleManager;
const bleManagerEmitter = new NativeEventEmitter(BleManagerModule);

const Tab = createBottomTabNavigator();

class App extends Component {
  constructor() {
    super();

    this.state = {
      settings: [],
      sensorData: [],
      scanning: false,
      peripherals: new Map(),
      appState: '',
    };

    this.handleDiscoverPeripheral = this.handleDiscoverPeripheral.bind(this);
    this.handleStopScan = this.handleStopScan.bind(this);
    this.handleUpdateValueForCharacteristic = this.handleUpdateValueForCharacteristic.bind(
      this,
    );
    this.handleDisconnectedPeripheral = this.handleDisconnectedPeripheral.bind(
      this,
    );
    this.handleAppStateChange = this.handleAppStateChange.bind(this);
    this.writeNewSettings = this.writeNewSettings.bind(this);
    this.hookUpSensorNotifications = this.hookUpSensorNotifications.bind(this);
  }

  async componentDidMount() {
    AppState.addEventListener('change', this.handleAppStateChange);

    try {
      await BleManager.start({ showAlert: false });
    } catch (error) {
      console.log('Cannot initialize BLE Module');
      return;
    }

    this.handlerDiscover = bleManagerEmitter.addListener(
      'BleManagerDiscoverPeripheral',
      this.handleDiscoverPeripheral,
    );

    this.handlerStop = bleManagerEmitter.addListener(
      'BleManagerStopScan',
      this.handleStopScan,
    );

    this.handlerDisconnect = bleManagerEmitter.addListener(
      'BleManagerDisconnectPeripheral',
      this.handleDisconnectedPeripheral,
    );

    this.handlerUpdate = bleManagerEmitter.addListener(
      'BleManagerDidUpdateValueForCharacteristic',
      this.handleUpdateValueForCharacteristic,
    );

    if (Platform.OS === 'android' && Platform.Version >= 23) {
      const result = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
      );

      if (result) {
        console.log('Permission is OK');
      } else {
        const res = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
        );

        if (res) {
          console.log('User accept');
        } else {
          console.log('User refuse');
        }
      }
    }

    this.startScan();
  }

  async handleAppStateChange(nextAppState) {
    if (
      this.state.appState.match(/inactive|background/) &&
      nextAppState === 'active'
    ) {
      console.log('App has come to the foreground!');

      const peripheralsArray = await BleManager.getConnectedPeripherals([]);

      if (peripheralsArray) {
        console.log('Connected peripherals: ' + peripheralsArray.length);
      }
    }

    this.setState({ appState: nextAppState });
  }

  componentWillUnmount() {
    this.handlerDiscover.remove();
    this.handlerStop.remove();
    this.handlerDisconnect.remove();
    this.handlerUpdate.remove();
  }

  handleDisconnectedPeripheral(data) {
    const { peripherals } = this.state;
    const peripheral = peripherals.get(data.peripheral);

    if (peripheral) {
      peripheral.connected = false;
      peripherals.set(peripheral.id, peripheral);
      this.setState({ peripherals });
    }
    console.log('Disconnected from ' + data.peripheral);
  }

  handleUpdateValueForCharacteristic(data) {
    if (!data.value) {
      return;
    }

    const value = decode(data.value);
    if (!value || value.indexOf('x') === -1 || value.split('x').length !== 3) {
      console.log('received sensorData is not formatted correctly', value);
      return;
    }

    const valueArr = value.split('x');
    const numbersArr = valueArr.map((item) => parseInt(item, 10));

    this.setState({ sensorData: numbersArr });
  }

  handleStopScan() {
    this.setState({ scanning: false }, async () => {
      console.log('Scan is stopped');
      const { peripherals } = this.state;

      if (!peripherals.size) {
        console.log('No device dettected');
        this.startScan();
        return;
      }

      const device = findPeripheral(peripherals, DEVICE_UUID);

      if (!device) {
        console.log(`Cannot detect device ${DEVICE_UUID}`);
        return;
      }

      if (!device.connected) {
        this.hookUpSensorNotifications(device);
      }
    });
  }

  async startScan() {
    if (this.state.scanning) {
      return;
    }

    const results = await BleManager.scan([], 3, true);

    if (results) {
      console.log('Scanning...');
      this.setState({ scanning: true });
    }
  }

  async retrieveConnected() {
    const results = await BleManager.getConnectedPeripherals([]);
    console.log('Connected peripherals', results);
    if (!results || results.length === 0) {
      console.log('No connected peripherals');
      return;
    }

    const { peripherals } = this.state;

    for (let i = 0; i < results.length; i++) {
      const peripheral = results[i];
      peripheral.connected = true;

      peripherals.set(peripheral.id, peripheral);
      this.setState({ peripherals });
    }
  }

  handleDiscoverPeripheral(peripheral) {
    const { peripherals } = this.state;

    if (!peripheral.name) {
      peripheral.name = 'NO NAME';
    }

    peripherals.set(peripheral.id, peripheral);
    this.setState({ peripherals });
  }

  async writeNewSettings(settingsArray) {
    const { settings } = this.state;

    if (
      !settingsArray.length ||
      (settings.length &&
        settings.length === settingsArray.length &&
        settings.length === 4 &&
        !difference(settings, settingsArray).length)
    ) {
      return;
    }

    const peripheralInfo = await BleManager.retrieveServices(DEVICE_UUID);
    console.log('peripheralInfo first for writing', peripheralInfo);

    if (!peripheralInfo) {
      return;
    }

    const settingsString = settingsArray.join('x');

    try {
      await BleManager.write(
        DEVICE_UUID,
        SERVICE_UUID_SETTINGS,
        CHARACTERISTIC_UUID_SETTINGS,
        stringToBytes(settingsString),
      );

      console.log(`Settings written on device ${DEVICE_UUID}`);
      this.setState({ settings: [...settingsArray] });
    } catch (error) {
      console.log('Settings write error', error);
    }
  }

  async hookUpSensorNotifications(peripheral) {
    if (!peripheral) {
      return;
    }

    if (peripheral.connected) {
      BleManager.disconnect(peripheral.id);
      return;
    }

    try {
      await BleManager.connect(peripheral.id);
      const { peripherals } = this.state;
      const p = peripherals.get(peripheral.id);

      if (p) {
        p.connected = true;
        peripherals.set(peripheral.id, p);
        this.setState({ peripherals });
      }

      console.log('Connected to ' + peripheral.id);

      const peripheralInfo = await BleManager.retrieveServices(peripheral.id);
      console.log(peripheralInfo);
      if (!peripheralInfo) {
        return;
      }

      try {
        await BleManager.startNotification(
          peripheral.id,
          SERVICE_UUID_SENSORS,
          CHARACTERISTIC_UUID_SENSORS,
        );

        console.log('Started notification on ' + peripheral.id);
      } catch (error) {
        console.log('Notification error', error);
      }
    } catch (error) {
      console.log('Connection error', error);
    }
  }

  render() {
    const { peripherals, sensorData } = this.state;
    const device = findPeripheral(peripherals, DEVICE_UUID);
    const isConnected = device && device.connected;

    if (isConnected) {
      return (
        <NavigationContainer>
          <Tab.Navigator>
            <Tab.Screen name="Charts">
              {(props) => (
                <>
                  <Appbar.Header>
                    <Appbar.Content
                      title={'Charts | BVM Ventilator Covid-19'}
                    />
                  </Appbar.Header>
                  <ChartsScreen {...props} sensorData={sensorData} />
                </>
              )}
            </Tab.Screen>
            <Tab.Screen name="Settings">
              {(props) => (
                <>
                  <Appbar.Header>
                    <Appbar.Content
                      title={'Settings | BVM Ventilator Covid-19'}
                    />
                  </Appbar.Header>
                  <SettingsScreen
                    {...props}
                    writeNewSettings={this.writeNewSettings}
                  />
                </>
              )}
            </Tab.Screen>
          </Tab.Navigator>
        </NavigationContainer>
      );
    }

    return (
      <ScreenContainer>
        <View style={styles.main}>
          <ActivityIndicator size="large" color="#f2b701" />
        </View>
      </ScreenContainer>
    );
  }
}

const styles = StyleSheet.create({
  main: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default App;