import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import PropTypes from 'prop-types';

import ScreenContainer from '../components/ScreenContainer';
import Chart from '../components/Chart';
// import useInterval from '../utils/useInterval';

const width = Dimensions.get('window').width;
const height = Math.floor((Dimensions.get('window').height - 200) / 3);
// let count = 1;

const ChartsScreen = (props) => {
  const [data, setData] = useState([-35, -21, -14, -5, 0, 0, 0, 0, 0, 12, 5, 24, 44, 28, 45]);
  const { sensorData } = props;
  const slotsPerWidth = 100;
/*
  useInterval(() => {
    let newData = [];
    if (count <= slotsPerWidth) {
      newData = [].concat(data);
      newData.push(Math.floor(Math.random() * 100));
      count++;
    } else {
      newData.push(data[data.length - 1]);
      count = 1;
    }
    setData(newData);
  }, 100);
*/

  useEffect(() => {
    if (sensorData[0]) {
      this.setData([...data, sensorData[0]]);
    }
  });

  return (
    <ScreenContainer>
      <View style={styles.main}>
        <Chart
          data={data}
          maxValue={50}
          minValue={-50}
          slotsPerWidth={slotsPerWidth}
          width={width}
          height={height}
          marginBottom={20}
          lineColor="rgba(95, 92, 1, 1)"
          lineThickness={2}
          chartBackground="#17204d"
          horizontalGridLinesCount={5}
          gridColor="rgba(65, 95, 93, .4)"
          gridThickness={1}
          unit="ml"
          axisTooClose={10}
          labelsColor="rgba(255, 255, 255, 0.8)"
          labelsFontSize={12}
          marginLeft={50}
          labelsMarginLeft={15}
        />
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  main: {
    flex: 1,
  },
});

ChartsScreen.propTypes = {
  sensorData: PropTypes.array.isRequired,
};

export default ChartsScreen;
