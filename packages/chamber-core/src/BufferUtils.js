const BigNumber = require('bignumber.js');

class BufferUtils {
  static bufferToNum(buf) {
    if(buf.length == 0) return 0;
    return new BigNumber('0x' + buf.toString('hex')).toNumber();
  }
  static bufferToBignum(buf) {
    if(buf.length == 0) return 0;
    return new BigNumber('0x' + buf.toString('hex'));
  }
  static hexToBuffer(hex) {
    return Buffer.from(hex.substr(2), 'hex');
  }
  static numToBuffer(n) {
    let str = new BigNumber(n).toString(16);
    if(str.length % 2 === 1) str = '0' + str;
    return Buffer.from(str, 'hex');
  }
}

module.exports = BufferUtils;
