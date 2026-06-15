const { expo } = require('./app.json');

module.exports = {
  ...expo,
  android: {
    ...expo.android,
    config: {
      googleMaps: {
        apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '',
      },
    },
  },
};
