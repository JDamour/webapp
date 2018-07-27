const utils = require('../utils.js');
const EventEmitter = require('events');
const { MESSAGE_STATE } = require('./chatMessage.js');

// const SEND_INTERVAL = 20;
// const RECV_INTERVAL = 30;
const SEND_INTERVAL = 10;
const RECV_INTERVAL = 15;


const EXT_SEP = '.';
const EXT_SEP_FB = '_';
const OFFLINE_MSG_EXT = 'cm';

function _throwIfUndef(aVarName, aVar) {
  if (aVar === undefined) {
    throw `${aVarName} is undefined`;
  }
}

class OfflineMessages {
  constructor(aUserId) {
    this.messages = {};
    this.user;
  }

  addMessage(aChatMsg) {
    if (aChatMsg) {
      const contactId = aChatMsg.from;
      const msgId = aChatMsg.id;

      if (!this.messages.hasOwnProperty(contactId)) {
        this.messages[contactId] = {};
      }

      if (!this.messages[contactId].hasOwnProperty(msgId)) {
        this.messages[contactId][msgId] = aChatMsg;
        return true;
      }
    }
    return false;
  }

  deleteMessage(aContactId, aMessageId) {
    if (this.hasMessage(aContactId, aMessageId)) {
      delete this.messages[aContactId][aMessageId];
    }
  }

  hasMessage(aContactId, aMessageId) {
    if (this.messages.hasOwnProperty(aContactId)) {
      if (this.messages[aContactId].hasOwnProperty(aMessageId)) {
        return true;
      }
    }
    return false;
  }

  getMessages(aContactId) {
    const messageIds = this.getMessageIds(aContactId);
    const messages = [];
    for (const messageId of messageIds) {
      const message = this.messages[aContactId][messageId];
      messages.push(message);
    }

    return (messages.sort(OfflineMessages._compareMessages));
  }

  // Gets messages from all users sorted in time order.
  //
  getAllMessages() {
    const allMessages = [];
    for (const userId of Object.keys(this.messages)) {
      const messagesById = this.messages[userId];
      for (const msgId of Object.keys(messagesById)) {
        const message = messagesById[msgId];
        allMessages.push(message);
      }
    }

    allMessages.sort(OfflineMessages._compareMessages);
    return allMessages;
  }

  getMessageIds(aContactId) {
    if (this.messages.hasOwnProperty(aContactId)) {
      return Object.keys(this.messages[aContactId]);
    }

    return [];
  }

  removeUntrackedContacts(aContactArr) {
    const contactIds = [];
    for (const contact of aContactArr) {
      contactIds.push(contact.id);
    }

    for (const trackedContactId of Object.keys(this.messages)) {
      if (!contactIds.includes(trackedContactId)) {
        delete this.messages[trackedContactId];
      }
    }
  }

  static _compareMessages(msgA, msgB) {
    return msgA.id - msgB.id;
  }
}


class OfflineMessagingServices extends EventEmitter {
  constructor(aLogger, aUserId, anIdxIoInst, aContactArr, logOutput = false) {
    super();

    _throwIfUndef('aLogger', aLogger);
    _throwIfUndef('aUserId', aUserId);
    _throwIfUndef('anIdxIoInst', anIdxIoInst);

    this.logger = aLogger;
    this.logOutput = logOutput;
    this.userId = aUserId;
    this.idxIoInst = anIdxIoInst;

    this.skipSend = false;
    this.enableSendService = false;
    this.writeQueue = [];

    this.enableRecvService = false;
    this.rcvdOfflineMsgs = new OfflineMessages();
    this.contactArr = aContactArr;

    // An object that stores an arrays of message IDs read offline by each user.
    this.offlineMsgIdsMarkedAsRead = {};
  }

  log(...args) {
    if (this.logOutput) {
      this.logger(...args);
    }
  }

  setContacts(aContactArr) {
    this.contactArr = aContactArr;
    this.rcvdOfflineMsgs.removeUntrackedContacts(aContactArr);
  }

  // TODO: this probably needs to be blocking so that multiple writes to the
  //       same area don't clobber the index file.  (e.g. user types two messages
  //       quickly, but one is not yet done writing and over-writes the index file.)
  //
  sendMessage(aContact, aChatMsg) {
    const isFirebase = this.idxIoInst.isFirebase();
    const sep = (isFirebase) ? EXT_SEP_FB : EXT_SEP;
    const fileName = `${aChatMsg.id}${sep}${OFFLINE_MSG_EXT}`;
    const filePath = `${aContact.id}/conversations/offline/${fileName}`;

    const hasPublicKey = (aContact.publicKey) ? (aContact.publicKey !== '') : false;
    if (!hasPublicKey) {
      throw `ERROR(offlineMessagingServices::sendMessage): unable to send message to ${aContact.id}. No public key available.`;
    }

    this.writeQueue.push({
      filePath,
      chatMsg: aChatMsg,
      publicKey: aContact.publicKey,
    });
  }

  removeMessages(aContact) {
    const dirPath = `${aContact.id}/conversations/offline`;

    // TODO: refactor this.
    // Rip any messages from this contact out of the queue.
    this.skipSend = true;
    const indicesToRemove = [];
    let index = 0;
    for (const messageTuple of this.writeQueue) {
      if (messageTuple.chatMsg &&
          (messageTuple.chatMsg.to === aContact.id)) {
        indicesToRemove.unshift(index);
      }
      index++;
    }
    if (indicesToRemove.length > 0) {
      for (const indexToRm of indicesToRemove) {
        this.writeQueue.splice(indexToRm, 1);
      }
    }
    this.skipSend = false;

    this.idxIoInst.deleteLocalDir(dirPath, aContact.publicKey);
  }

  deleteMessagesFromStorage(aContact, aMessageIdList) {
    const isFirebase = this.idxIoInst.isFirebase();
    const sep = (isFirebase) ? EXT_SEP_FB : EXT_SEP;

    const dirPath = `${aContact.id}/conversations/offline`;

    const fileList = [];
    for (const msgId of aMessageIdList) {
      fileList.push(`${msgId}${sep}${OFFLINE_MSG_EXT}`);
    }

    this.idxIoInst.deleteLocalFiles(dirPath, fileList, aContact.publicKey);
  }

  async sendMessagesToStorage() {
    this.log('Offline Messaging Send Service:');

    let count = 0;
    while (this.writeQueue.length > 0) {
      const messageTupleArr = this.writeQueue.splice(0, 1);
      const messageTuple = messageTupleArr[0];

      messageTuple.chatMsg.msgState = MESSAGE_STATE.SENT_OFFLINE;
      this.log(`   sending message offline to ${messageTuple.chatMsg.to}`);
      this.log(`   (filepath = ${messageTuple.filePath})`);
      await this.idxIoInst.writeLocalFile(messageTuple.filePath,
                                          messageTuple.chatMsg,
                                          messageTuple.publicKey);

      count++;
    }

    if (count > 0) {
      // Kick of an event to update the messages gui as we've changed
      // message status fields in memory held by MessagePage::conversations.
      this.emit('offline messages sent');

      this.log(`   sent ${count} offline messages. Sleeping ${SEND_INTERVAL}s.`);
    }
  }

  async startSendService() {
    this.enableSendService = true;
    while (this.enableSendService) {
      if (!this.skipSend) {
        this.sendMessagesToStorage();
      }

      const sleepResult = await utils.resolveAfterMilliseconds(SEND_INTERVAL * 1000);
    }
  }

  skipSendService(skip = true) {
    this.skipSend = skip;
  }

  stopSendService() {
    this.enableSendService = false;
  }


  static _getNameMinusExtension(aFileName, isFirebase = false) {
    const extSep = (isFirebase) ? EXT_SEP_FB : EXT_SEP;
    const idx = aFileName.lastIndexOf(extSep);
    if (idx !== -1) {
      return aFileName.substr(0, idx);
    }

    return aFileName;
  }

  async startRecvService() {
    const isFirebase = this.idxIoInst.isFirebase();
    this.enableRecvService = true;
    while (this.enableRecvService) {
      this.log('Offline Messaging Receive Service:');


      const chatMessagesReadPromises = [];
      for (const contact of this.contactArr) {
        // Using Contact obj. here for future expansion w.r.t. heartBeat.
        const contactId = contact.id;
        const offlineDirPath = `${this.userId}/conversations/offline`;

        let indexData;
        try {
          indexData = await this.idxIoInst.readRemoteIndex(contactId, offlineDirPath);
          this.log(`   Finished reading remote index of ${contactId} (${offlineDirPath}).`);
        } catch (err) {
          // Suppress 404 for users who haven't written a sharedIndex yet.
        }

        if (indexData && indexData.active) {
          for (const chatMsgFileName in indexData.active) {
            const msgIdForFile =
              OfflineMessagingServices._getNameMinusExtension(chatMsgFileName, isFirebase);
            if (this.rcvdOfflineMsgs.hasMessage(contactId, msgIdForFile)) {
              continue;
            }

            const chatMsgFilePath = `${offlineDirPath}/${chatMsgFileName}`;
            chatMessagesReadPromises.push(this.idxIoInst.readRemoteFile(contactId, chatMsgFilePath));
          }
        }

        // TODO:
        // const offlineMsgsFilePath = `${offlineDirPath}/read.json`;
        // this.idxIoInst.readRemoteFile(contactId, offlineMsgsFilePath);
      }

      Promise.all(chatMessagesReadPromises)
      .then((chatMessageObjs) => {
        let count = 0;
        for (const chatMsg of chatMessageObjs) {
          if (this.rcvdOfflineMsgs.addMessage(chatMsg)) {
            count++;
          }
        }

        if (count) {
          this.log(`   received ${count} offline messages.`);
          const allMessages = this.rcvdOfflineMsgs.getAllMessages();
          this.emit('new messages', allMessages);
        }
      })
      .catch((err) => {
        this.logger(`ERROR: offline messaging services failed to read chat message. ${err}.`);
      });

      const sleepResult = await utils.resolveAfterMilliseconds(RECV_INTERVAL * 1000);
    }
  }

  stopRecvService() {
    this.enableSendService = false;
  }
}


module.exports = { OfflineMessagingServices };
