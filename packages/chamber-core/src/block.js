const SparseMerkleTree = require('./smt');
const {
  TransactionOutput,
  Transaction
} = require('./tx');

const {
  SMT_DEPTH,
  CHUNK_SIZE
} = require('./constant');

/*
* Only concerns for latest raw Block
* Older generated blocks are basically on leveldb
*/
class Block {
  
  constructor(number, isDepositBlock) {
    this.id = null;
    this.number = number;
    this.hash = null;
    this.prevhash = null;
    this.txs_root = null;
    this.stateRoot = null;
    this.isDepositBlock = isDepositBlock || false;
    this.txs = [];
    this.timestamp = Date.now();
    this.nonce = null;
    this.gaslimit = 0;
    this.gasused = 0;
    this.tree = null;
  }

  appendTx(tx) {
    this.txs.push(tx);
    return tx;
  }

  getTxIndex(tx) {
    for(var i = 0;i < this.txs.length;i++) {
      if(Buffer.compare(this.txs[i].hash(), tx.hash()) == 0) {
        return i;
      }
    }
    return -1;
  }

  createTree() {
    if(this.tree !== null) return this.tree;
    let leaves = Array.from(Array(Math.pow(2, SMT_DEPTH)), (item, index) => null);
    this.txs.forEach(tx=>{
      tx.outputs.forEach((o) => {
        o.value.forEach(({start, end}) => {
          const slot = TransactionOutput.amountToSlot(CHUNK_SIZE, start);
          const slotEnd = TransactionOutput.amountToSlot(CHUNK_SIZE, end);
          for(var i = slot;i < slotEnd;i++) {
            leaves[i] = tx.hash();
          }
        })
      })
    })
    this.tree = new SparseMerkleTree(SMT_DEPTH, leaves);
    return this.tree;
  }

  createCoinProof(uid) {
    const tree = this.createTree();
    return tree.proof(uid);
  }

  createTXOProof(txo) {
    const tree = this.createTree();
    return txo.value.map(({start, end}) => {
      const slot = TransactionOutput.amountToSlot(CHUNK_SIZE, start);
      return tree.proof(slot);
    }).reduce((acc, p) => {
      return Buffer.concat(acc.concat([p]));
    }, []);
  }

  createTxProof(tx) {
    const slots = tx.outputs.reduce((slots, o) => {
      const slot = o.value.map(({start, end}) => {
        return TransactionOutput.amountToSlot(CHUNK_SIZE, start);
      });
      return slots.concat(slot);
    }, []);
    const tree = this.createTree();
    return slots.map((slot) => tree.proof(slot)).reduce((acc, p) => {
      return Buffer.concat(acc.concat([p]))
    }, []);
  }

  merkleHash() {
    const tree = this.createTree();
    return tree.root();
  }

  setStateRoot(stateRoot) {
    this.stateRoot = stateRoot;
  }

  /**
   * @dev serialize to string
   */
  toString() {
    return JSON.stringify(this.toJson());
  }

  toJson() {
    return {
      id: this.id,
      number: this.number,
      hash: this.hash,
      prevhash: this.prevhash,
      txs_root: this.txs_root,
      stateRoot: this.stateRoot,
      txs: this.txs.map(tx => {
        return tx.getBytes(true).toString('hex')
      }),
      timestamp: this.timestamp,
      nonce: this.nonce,
      gaslimit: this.gaslimit,
      gasused: this.gasused,
      isDepositBlock: this.isDepositBlock
    };
  }
  
  /**
   * @dev deserialize from string
   */
  static fromString(str) {
    const block = JSON.parse(str);
    const empty = new Block(block.number, block.isDepositBlock);
    empty.id = block.id;
    empty.number = block.number;
    empty.hash = block.hash;
    empty.stateRoot = block.stateRoot;
    empty.txs = block.txs ? block.txs.map(tx => {
      return Transaction.fromBytes(new Buffer(tx, 'hex'))
    }) : [];
    return empty;
  }

}

module.exports = Block
