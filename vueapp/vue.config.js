// vue.config.js
var webpack = require('webpack')

module.exports = {
  // options...
  publicPath: '/app/',
  // //https://rimdev.io/vue-cli-environment-variables/
  configureWebpack: {
    plugins: [
      new webpack.DefinePlugin({
        'process.env': {
          'API_URL': JSON.stringify(process.env.ALBDNS)
        }
      })
    ]
  }
}
