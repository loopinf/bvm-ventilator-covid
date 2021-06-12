import 'react-native-gesture-handler';
import React, { Component } from 'react';
import {
  StyleSheet,
  View,
  NativeEventEmitter,
  NativeModules,
  Platform,
  PermissionsAndroid,
  AppState,
  ActivityIndicator,
  Button,
} from 'react-native';
import BleManager from 'react-native-ble-manager';
import difference from 'lodash.difference';
import { stringToBytes } from 'convert-string';

import ScreenContainer from './components/ScreenContainer';
import Navigation from './components/Navigation';

import { decode } from './utils/utf8Convertor';
import {
  DEVICE_UUID,
  SERVICE_UUID_SETTINGS,
  SERVICE_UUID_SENSORS,
  CHARACTERISTIC_UUID_SETTINGS,
  CHARACTERISTIC_UUID_SENSORS,
} from './secrets/bleUUIDs';
import findPeripheral from './utils/findPeripheral';

const BleManagerModule = NativeModules.BleManager;
const bleManagerEmitter = new NativeEventEmitter(BleManagerModule);

class App extends Component {
  state = {
    settings: [],
    sensorData: [],
    scanning: false,
    peripherals: new Map(),
    appState: '',
  };

  convert16bitIntToFloat = (num) => {
    if ((num & 0x8000) > 0) {
      num = num - 0x10000;
    }
    return num;
  };

  convertUnit8ToUintArray16Array = (value) => {
    // const value = value;
    const arr16 = new Uint16Array(18);
    arr16[0] = (value[3] << 8) + value[2]; // ax
    arr16[1] = (value[5] << 8) + value[4]; // ay
    arr16[2] = (value[7] << 8) + value[6]; // az
    arr16[3] = (value[9] << 8) + value[8]; // wx
    arr16[4] = (value[11] << 8) + value[10]; // wy
    arr16[5] = (value[13] << 8) + value[12]; // wz
    arr16[6] = (value[15] << 8) + value[14]; // roll
    arr16[7] = (value[17] << 8) + value[16]; // pitch
    arr16[8] = (value[19] << 8) + value[18]; // yaw

    let ax = (this.convert16bitIntToFloat(arr16[0]) / 32768) * 16; // unit [g]
    let ay = (this.convert16bitIntToFloat(arr16[1]) / 32768) * 16;
    let az = (this.convert16bitIntToFloat(arr16[2]) / 32768) * 16;

    let wx = (this.convert16bitIntToFloat(arr16[3]) / 32768) * 2000; //  deg/s
    let wy = (this.convert16bitIntToFloat(arr16[4]) / 32768) * 2000;
    let wz = (this.convert16bitIntToFloat(arr16[5]) / 32768) * 2000;

    let roll = (this.convert16bitIntToFloat(arr16[5]) / 32768) * 180; // deg
    let pitch = (this.convert16bitIntToFloat(arr16[5]) / 32768) * 180;
    let yaw = (this.convert16bitIntToFloat(arr16[5]) / 32768) * 180;

    return arr16;
  };

  componentDidMount = async () => {
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

    // this.startScan();
  };

  handleAppStateChange = async (nextAppState) => {
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
  };

  componentWillUnmount = () => {
    AppState.removeEventListener('change');
    this.handlerDiscover.remove();
    this.handlerStop.remove();
    this.handlerDisconnect.remove();
    this.handlerUpdate.remove();
  };

  handleDisconnectedPeripheral = (data) => {
    const { peripherals } = this.state;
    const peripheral = peripherals.get(data.peripheral);

    if (peripheral) {
      peripheral.connected = false;
      peripherals.set(peripheral.id, peripheral);
      this.setState({ peripherals });
    }
    console.log('Disconnected from ' + data.peripheral);
  };

  handleUpdateValueForCharacteristic = (data) => {
    if (!data.value) {
      return;
    }
    // console.log(`data.value, ${data.value}`);

    // const value = decode(data.value);
    const value = data.value;

    let az =
      (this.convert16bitIntToFloat((value[7] << 8) + value[6]) / 32768) * 16;
    // console.log(`az  ${az}`);
    // if (!value || value.indexOf('x') === -1 || value.split('x').length !== 3) {
    //   console.log('Received sensorData is not formatted correctly', value);
    //   return;
    // }

    // const valueArr = value.split('x');
    // const valueArr = this.convertUnit8ToUintArray16Array(value) // TODO

    // const numbersArr = valueArr.map((item) => parseInt(item, 10));
    const numbersArr = new Uint16Array(3);
    numbersArr[0] = az;

    this.setState({ sensorData: numbersArr });
  };

  handleStopScan = () => {
    this.setState({ scanning: false }, async () => {
      console.log('Scan is stopped');
      const { peripherals } = this.state;

      if (!peripherals.size) {
        console.log('No device dettected');
        this.startScan();
        return;
      }

      console.log(`peripherals ${peripherals}`);

      const device = findPeripheral(peripherals, DEVICE_UUID);
      console.log(`device ${device}`);

      if (!device) {
        console.log(`Cannot detect device ${DEVICE_UUID}`);
        return;
      }

      console.log(`device : ${device}`);
      if (!device.connected) {
        this.hookUpSensorNotifications(device);
      }
    });
  };

  startScan = async () => {
    console.log('startScan');
    if (this.state.scanning) {
      return;
    }
    const results = await BleManager.scan([], 5, true);
    console.log('results', results);

    if (results) {
      console.log('Scanning...');
      this.setState({ scanning: true });
    }
  };

  handleDiscoverPeripheral = (peripheral) => {
    const { peripherals } = this.state;

    if (!peripheral.name) {
      peripheral.name = 'NO NAME';
    }

    peripherals.set(peripheral.id, peripheral);
    this.setState({ peripherals });
  };

  writeNewSettings = async (settingsArray) => {
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
  };

  hookUpSensorNotifications = async (peripheral) => {
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
  };

  render = () => {
    const { peripherals, sensorData } = this.state;
    const device = findPeripheral(peripherals, DEVICE_UUID);
    const isConnected = device && device.connected;

    if (isConnected) {
      return (
        <Navigation
          sensorData={sensorData}
          writeNewSettings={this.writeNewSettings}
        />
      );
    }

    return (
      <ScreenContainer>
        <View style={styles.main}>
          <Button title="TEST" onPress={() => this.startScan()} />
          <ActivityIndicator size="large" color="#f2b701" />
        </View>
      </ScreenContainer>
    );
  };
}

const styles = StyleSheet.create({
  main: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default App;
