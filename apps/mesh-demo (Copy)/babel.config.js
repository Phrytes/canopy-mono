module.exports = {
  presets: ['@react-native/babel-preset'],
  plugins: [
    // Allow Metro to resolve ESM packages (the @canopy/* packages use "type":"module")
    '@babel/plugin-transform-modules-commonjs',
  ],
};
