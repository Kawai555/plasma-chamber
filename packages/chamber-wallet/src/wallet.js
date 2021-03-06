const utils = require('ethereumjs-util')
const RLP = require('rlp')
const BN = utils.BN

const {
  MockStorage,
  MockBigStorage
} = require('./storage')
const ChildChainApi = require('./childchain')
const {
  Block,
  Constants,
  TransactionOutput,
  Transaction
} = require('@cryptoeconomicslab/chamber-core')
const BigNumber = require('bignumber.js');
const {
  CHUNK_SIZE
} = Constants


class BaseWallet {
  constructor(_options) {
    const options = _options || {}
    this.childChainApi = new ChildChainApi(options.childChainEndpoint || process.env.CHILDCHAIN_ENDPOINT || 'http://localhost:3000');
    this.operatorAddress = options.operatorAddress || process.env.OPERATOR_ADDRESS || '0x627306090abab3a6e1400e9345bc60c78a8bef57';
    this.rootChainAddress = options.rootChainAddress
    this.address = null
    this.utxos = {}
    this.storage = options.storage || MockStorage
    this.bigStorage = options.bigStorage || new MockBigStorage()
    this.latestBlockNumber = 0;
    this.loadedBlockNumber = this.storage.load('loadedBlockNumber') || 0;
  }

  setAddress(address) {
    // address is hex string and checksum address
    this.address = address
  }

  setPrivateKey(privKey) {
    this.privKey = privKey
  }

  setWeb3(web3) {
    this.web3 = web3
  }

  setWeb3Child(web3Child) {
    this.web3Child = web3Child
  }

  setRootChainContract(rootChainContract) {
    return this.rootChainContract = rootChainContract
  }

  getAddress() {
    return this.address
  }

  getChildChainApi() {
    return this.childChainApi
  }

  async getBlockNumber() {
    const res = await this.childChainApi.getBlockNumber()
    return res.result
  }

  /**
   * getBalance
   * @description get balance of plasma chain
   */
  getBalance() {
    const utxos = this.getUTXOs()
    return utxos.filter(utxo => {
      return utxo.state.length == 0 || utxo.state[0] === 0;
    }).reduce((acc, utxo) => {
      return acc.plus(utxo.value[0].end.div(CHUNK_SIZE).minus(utxo.value[0].start.div(CHUNK_SIZE)));
    }, BigNumber(0))
  }

  /**
   * update
   * @description Update history of UTXOs by using child chain API.
   */
  update() {
    return this.getBlockNumber().then((latestBlockNumber) => {
      this.latestBlockNumber = latestBlockNumber;
      let tasks = [];
      for(let i = this.loadedBlockNumber + 1;i <= this.latestBlockNumber;i++) {
        tasks.push(this.childChainApi.getBlockByNumber(i));
      }
      return Promise.all(tasks);
    }).then((responses) => {
      responses.map(res => {
        const block = res.result
        this.updateHistoryWithBlock(Block.fromString(JSON.stringify(block)))
      });
      this.updateLoadedBlockNumber(this.latestBlockNumber);
      return this.getUTXOs();
    });
  }

  async deposit(eth) {
    return await this.rootChainContract.methods.deposit(
      this.operatorAddress
    ).send({
      from: this.address,
      gas: 200000,
      value: (new BN("1000000000000000000")).mul(new BN(eth))
    })
  }

  async startExit(utxo) {
    const txList = await this.getTransactions(utxo, 2)
    const txListBytes = RLP.encode(txList);
    const latestTx = txList[txList.length - 1];

    return this.rootChainContract.methods.startExit(
      this.operatorAddress,
      latestTx[0],
      latestTx[4],
      utils.bufferToHex(txListBytes)
    ).send({
      from: this.address,
      gas: 1000000,
      // Exit Bond
      // value: new BN("1000000000000000000")
    })

  }

  getUTXOs() {
    return Object.keys(this.utxos).map(k => {
      return TransactionOutput.fromTuple(RLP.decode(Buffer.from(this.utxos[k], 'hex')));
    });
  }

  getHistory(utxoKey) {
    return this.bigStorage.searchProof(utxoKey);
  }

  // private methods

  /**
   * getTransactions
   * @param {TransactionOutput} utxo 
   * @param {Number} num 
   * @description get transactions by the UTXO
   */
  async getTransactions(utxo, num) {
    const slots = utxo.value.map(({start, end}) => {
      return TransactionOutput.amountToSlot(CHUNK_SIZE, start)
    })
    const history = await this.bigStorage.get(slots[0], utxo.blkNum)
    const tx = this.hexToTransaction(history.txBytes)
    const prevTxo = tx.inputs[0];
    const prevHistory = await this.bigStorage.get(slots[0], prevTxo.blkNum)
    const prevTx = this.hexToTransaction(prevHistory.txBytes)
    const prevIndex = this.getIndexOfOutput(prevTx, prevTxo)
    const index = this.getIndexOfOutput(tx, utxo)
    return [[
      prevHistory.blkNum,
      prevTx.getBytes(),
      Buffer.from(prevHistory.proof, 'hex'),
      prevTx.sigs[0],
      prevIndex
    ], [
      history.blkNum,
      tx.getBytes(),
      Buffer.from(history.proof, 'hex'),
      tx.sigs[0],
      index
    ]]
  }

  updateLoadedBlockNumber(n) {
    this.loadedBlockNumber = n;
    this.storage.store('loadedBlockNumber', this.loadedBlockNumber);
  }

  /**
   * filterOwner
   * @param {TransactionOutput} txo
   * @description if txo has this.address as owners, this method return true
   */
  filterOwner(txo) {
    return txo.owners.map(ownerAddress => {
      return utils.toChecksumAddress(ownerAddress)
    }).indexOf(this.address) >= 0
  }

  /**
   * updateHistoryWithBlock
   * @param {Block} block 
   */
  updateHistoryWithBlock(block) {
    const transactions = block.txs
    transactions.reduce((acc, tx) => {
      return acc.concat(tx.inputs)
    }, []).filter(this.filterOwner.bind(this)).forEach((spentUTXO) => {
      const key = spentUTXO.hash().toString('hex')
      console.log('delete', spentUTXO.blkNum, block.number, spentUTXO.value)
      delete this.utxos[key]
    });
    let newTx = {}
    transactions.forEach(tx => {
      tx.outputs.forEach((utxo, i) => {
        if(this.filterOwner(utxo)) {
          const key = utxo.hash(block.number).toString('hex')
          this.utxos[key] = utxo.getBytes(block.number).toString('hex')
          newTx[key] = {
            txBytes: tx.getBytes(true).toString('hex'),
            index: i
          };
          console.log('insert', block.number, utxo.value, i)
        }
      })
    })
    let chunks = []
    transactions.forEach(tx => {
      tx.outputs.forEach((utxo, oIndex) => {
        utxo.value.forEach(({start, end}, i) => {
          const slot = TransactionOutput.amountToSlot(CHUNK_SIZE, start)
          chunks[slot] = {
            txBytes: tx.getBytes(true).toString('hex'),
            index: oIndex,
            output: utxo
          }
        })
      })
    })
    // getting proof
    Object.keys(this.utxos).forEach(key => {
      TransactionOutput.fromBytes(Buffer.from(this.utxos[key], 'hex')).value.map(({start, end}) => {
        const slot = TransactionOutput.amountToSlot(CHUNK_SIZE, start)
        const proof = this.calProof(
          block,
          transactions,
          slot)
        
        if(newTx.hasOwnProperty(key)) {
          console.log('update 1', block.number)
          // inclusion
          this.bigStorage.add(
            slot,
            block.number,
            proof,
            newTx[key].txBytes,
            newTx[key].index
          )
        }else{
          console.log('update 2', block.number)
          // non-inclusion
          if(chunks[slot]) {
            this.bigStorage.add(
              slot,
              block.number,
              proof,
              chunks[slot].txBytes,
              chunks[slot].index
            );
          }else{
            console.log('update 3', block.number)
            this.bigStorage.add(
              slot,
              block.number,
              proof,
              this.zeroHash
            );
          }
        }
      })
    })
    this.storage.store('utxo', this.utxos)
  }

  calProof(blockJson, transactions, chunk) {
    const block = new Block(blockJson.number)
    transactions.forEach(tx => {
      block.appendTx(tx)
    });
    return block.createCoinProof(chunk).toString('hex')
  }

  getIndexOfOutput(tx, utxo) {
    let index = 0
    tx.outputs.map((o, i) => {
      if(Buffer.compare(o.hash(utxo.blkNum), utxo.hash()) == 0) {
        index = i
      }
    });
    return index
  }

  hexToTransaction(txBytes) {
    return Transaction.fromBytes(Buffer.from(txBytes, 'hex'));
  }

}

module.exports = {
  BaseWallet
}
