const utils = require('../utils.js');

const EventEmitter = require('events');

// HeartBeat:
//  Every minute, wake up and write an encrypted heartbeat file to each contact
//  we are associated with that we do not have a peer connection to.
//
//  Version 1.0 of a heartbeat file includes:
//  {
//    time: currentTimeUTC,
//  }
//
//  Future versions of the heartbeat file could include:
//  {
//    time: currentTimeUTC,
//    sdpInvite: serializedSdpInvite,
//    lastMessageId: idOfLastMessageInConversation,
//  }
//
const HB_INTERVAL = 30;
const HB_MONITOR_INTERVAL = 30;
const HB_FILE_NAME = 'hb.sesj';


class HeartBeat extends EventEmitter {
  constructor(logger,
              anIoDriver,
              aUserId,
              aContactArr,
              aPrivateKey,
              encryption = true,
              logOutput = false) {
    super();

    utils.throwIfUndef('logger', logger);
    utils.throwIfUndef('anIoDriver', anIoDriver);
    utils.throwIfUndef('aUserId', aUserId);
    utils.throwIfUndef('aContactArr', aContactArr);
    utils.throwIfUndef('aPrivateKey', aPrivateKey);
    utils.throwIfUndef('encryption', encryption);

    this.logger = logger;
    this.logOutput = logOutput;
    this.contactIdKeys = {};
    this.io = anIoDriver;
    this.userId = aUserId;
    this.encryption = encryption;

    this.enableBeat = false;
    this.firstBeat = true;

    this.enableMonitor = false;
    this.heartBeats = {};
    this.privateKey = aPrivateKey;

    for (const contact of aContactArr) {
      if (utils.isDef(contact) && utils.isDef(contact.publicKey) && utils.isDef(contact.id)) {
        this.contactIdKeys[contact.id] = contact.publicKey;
        this.heartBeats[contact.id] = undefined;
      }
    }

    this.on('HeartBeat', this._writeHeartBeatFiles);
    this.on('HeartBeatMonitor', this._readHeartBeatFiles);
    this.on('firstBeatComplete', this.startMonitor);
  }

  log(aString) {
    if (this.logOutput) {
      this.logger(aString);
    }
  }

  addContact(aContactId, aPublicKey) {
    if (utils.isDef(aContactId) && utils.isDef(aPublicKey)) {
      this.contactIdKeys[aContactId] = aPublicKey;
      this.heartBeats[aContactId] = undefined;
    }
  }

  removeContact(aContactId) {
    if (!utils.isDef(aContactId)) {
      return;
    }
    if (aContactId in this.contactIdKeys) {
      delete this.contactIdKeys[aContactId];
    }
    if (aContactId in this.heartBeats) {
      delete this.heartBeats[aContactId];
    }
  }

  deleteContact(aContactId) {
    if (!utils.isDef(aContactId)) {
      return;
    }

    this.removeContact(aContactId);

    const filePath = `${aContactId}/${HB_FILE_NAME}`;
    this.io.deleteLocalFile(this.userId, filePath);
  }

  getHeartBeats() {
    return this.heartBeats;
  }

  getHeartBeat(aUserId) {
    if (utils.isDef(aUserId) && (aUserId in this.heartBeats)) {
      return this.heartBeats[aUserId];
    }
    return undefined;
  }

  async startBeat() {
    this.enableBeat = true;

    while (this.enableBeat) {
      this.log('HeartBeat!');
      this.emit('HeartBeat');

      if (this.firstBeat) {
        this.emit('firstBeatComplete');
        this.firstBeat = false;
      }

      const sleepForMs = (HB_INTERVAL * 1000);
      const sleepResult = await utils.resolveAfterMilliseconds(sleepForMs);
    }
  }

  stopBeat() {
    this.enableBeat = false;
  }

  async startMonitor() {
    this.log('Starting HeartBeat Monitor');
    this.enableMonitor = true;

    while (this.enableMonitor) {
      this.log('HeartBeat Monitor!');
      this.emit('HeartBeatMonitor');

      const sleepForMs = (HB_MONITOR_INTERVAL * 1000);
      const sleepResult = await utils.resolveAfterMilliseconds(sleepForMs);
    }
  }

  async stopMonitor() {
    this.enableMonitor = false;
  }

  _writeHeartBeatFiles() {
    this.log('Write HeartBeat files!');
    const heartBeatObj = { userId: this.userId, time: Date.now() };

    const writePromises = [];
    for (const contactId in this.contactIdKeys) {
      const filePath = `${contactId}/${HB_FILE_NAME}`;

      let writeObj;
      if (this.encryption) {
        const contactPubKey = this.contactIdKeys[contactId];
        writeObj = utils.encryptObj(contactPubKey, heartBeatObj);
      } else {
        writeObj = heartBeatObj;
      }

      try {
        writePromises.push(this.io.writeLocalFile(this.userId, filePath, writeObj));
      } catch (err) {
        this.logger('ERROR: writing heartbeat file ${filePath}. ${err}');
      }
    }

    return Promise.all(writePromises)
    .then((values) => {
      this.log('HeartBeat successful.');
    })
    .catch((err) => {
      this.logger(`ERROR: HeartBeat write failure. ${err}`);
    });
  }


  _readHeartBeatFiles() {
    this.log('Read HeartBeat files!');
    const readPromises = [];

    for (const contactId in this.contactIdKeys) {
      const filePath = `${this.userId}/${HB_FILE_NAME}`;
      try {
        readPromises.push(this.io.readRemoteFile(contactId, filePath));
      } catch (err) {
        this.logger('ERROR: reading heartbeat file ${filePath}. ${err}');
      }
    }

    return Promise.all(readPromises)
    .then((values) => {
      this.log('HeartBeat Monitor cycle successful.');

      for (const value of values) {
        if (utils.isDef(value) && !utils.isEmptyObj(value)) {
          if (this.encryption && utils.isObjEncrypted(value)) {
            const decryptedValue = utils.decryptToObj(this.privateKey, value);
            this.heartBeats[decryptedValue.userId] = decryptedValue;
          } else {
            this.heartBeats[value.userId] = value;
          }
        } else {
          // value resolved to null or {} in _readHeartBeatFiles
          // This happens when a heartbeat file does not exist for a user
          // or a user has deleted another user.
        }
      }
      this.emit('monitor', this.heartBeats);
    })
    .catch((err) => {
      this.logger(`ERROR (Heartbeat Monitor): ${err}`);
    });
  }

}
module.exports = { HeartBeat };
