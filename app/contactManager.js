const utils = require('./utils.js');
const constants = require('./constants.js');
const statusIndicators = constants.statusIndicators;

const SUMMARY_LEN = 27;
const LEAN_PLUGIN = false;

// This class is written in such a way that new objects are allocated instead of
// re-using / connecting existing objects (b/c we wouldn't want an activeContact
// that is not contained in the contactArr).
class ContactManager {
  constructor() {
    this.contactArr = [];
    this.activeContact = undefined;
    this.pluginMode = false;
    this.dropDownContacts = [];
  }

  clone(aContactManager) {
    if (aContactManager) {
      const contactArr = aContactManager.getAllContacts();
      const activeContact = aContactManager.getActiveContact();

      this.pluginMode = aContactManager.isPlugin();

      this.initFromArray(contactArr, activeContact);
    }
  }

  // Initialize from an array stored in the cloud (usually the first load of
  // contacts). This clears some data before proceeding to Initialize the object.
  initFromStoredArray(aContactArr) {
    if (aContactArr && (aContactArr.length > 0)) {
      for (const contact of aContactArr) {
        contact.unread = 0;
        contact.time = '';
      }
      this.initFromArray(aContactArr);
    }
  }

  initFromArray(aContactArr, activeContact = undefined) {
    if (aContactArr && (aContactArr.length > 0)) {
      // Clone and then copy the contact array, but eliminate duplicate
      // contacts.
      const tempContactArr = utils.deepCopyObj(aContactArr);
      for (const aContact of tempContactArr) {
        if (ContactManager._getContactForId(aContact.id, this.contactArr)) {
          // TODO: throw / warn if duplicate detected.
          continue;
        }
        this.contactArr.push(aContact);
      }

      if (activeContact) {
        // Find the cloned active contact object and assign it.
        for (const contact of this.contactArr) {
          if (contact.id === activeContact.id) {
            this.activeContact = contact;
            break;
          }
        }
      } else {
        this.activeContact = this.contactArr[0];
      }
      this.dropDownContacts = this.initContactDetailsForDropDown()
    }
  }

  initContactDetailsForDropDown() {
    const myContactArr = this.getAllContacts()
    const activeContact = this.getActiveContact();
    let contacts = []
    let key = 0;
    for (const contact of myContactArr) {
      let name = contact.id;
      if (contact.title) {
        const idx = contact.title.indexOf(' ');
        name = (idx > -1) ?
          contact.title.substr(0, idx) : contact.title;
      }
      const text = name;
      const value = contact.id;
      const image = {
        avatar: true,
        src: contact.image
      }
      if (activeContact && activeContact.id === contact.id) {
        contacts.unshift({key, text, value, image, contact, name})
      }
      else {
        contacts.push({key, text, value, image, contact, name})
      }
      key += 1;
    }
    return contacts;
  }
//
//
// ContactMgr configuration operations:
// //////////////////////////////////////////////////////////////////////////////
//
  isPlugin() {
    return this.pluginMode;
  }

  setPlugInMode(aUserId) {
    const plugInContact = this.getContact(aUserId);
    if (plugInContact) {
      this.pluginMode = true;
      this.activeContact = plugInContact;
      return;
    }

    throw `ERROR: user ID undefined in contact manager plug in mode.`
  }
//
//
// All contact operations:
// //////////////////////////////////////////////////////////////////////////////
//
  setAllContactsStatus(aStatus = statusIndicators.offline) {
    for (const contact of this.contactArr) {
      contact.status = aStatus;
    }
  }

  getContacts() {
    if (this.pluginMode && LEAN_PLUGIN) {
      return [this.activeContact];
    }

    return this.contactArr;
  }

  getAllContacts() {
    return this.contactArr;
  }

  setContacts(aContactArr) {
    this.contactArr = (aContactArr) || [];
  }

  getContactIds() {
    if (this.pluginMode && LEAN_PLUGIN) {
      return [this.activeContact.id];
    }

    const userIds = [];
    for (const contact of this.contactArr) {
      userIds.push(contact.id);
    }
    return userIds;
  }

  getAllContactIds() {
    const userIds = [];
    for (const contact of this.contactArr) {
      userIds.push(contact.id);
    }
    return userIds;
  }

  getDropDownContacts() {
    return this.dropDownContacts;
  }

//
//
// Single contact operations:
// //////////////////////////////////////////////////////////////////////////////
//
  getActiveContact() {
    return this.activeContact;
  }

  setActiveContact(aContact) {
    this.activeContact = aContact;
  }

  isActiveContactId(aContactId) {
    if (aContactId) {
      if (this.activeContact) {
        return (aContactId === this.activeContact.id);
      }
    }
    return false;
  }

  addNewContact(aContact, id, publicKey, makeActiveContact = true) {
    const newContact = utils.deepCopyObj(aContact);
    newContact.id = id;
    newContact.publicKey = publicKey;

    // Defaults:
    newContact.summary = '';
    newContact.time = '';
    newContact.unread = 0;

    this.addContact(newContact, makeActiveContact);
  }

  addContact(aContact, makeActiveContact = true) {
    if (aContact) {
      // Check to see if we already have this contact, if so, issue an info message.
      if (this.getContact(aContact.id)) {
        // TODO: info message.
        return;
      }

      this.contactArr.splice(0, 0, aContact);

      if (makeActiveContact) {
        this.activeContact = aContact;
      }

      this.dropDownContacts = this.initContactDetailsForDropDown();
    }
  }

  getContact(aContactId) {
    if (aContactId) {
      return ContactManager._getContactForId(aContactId, this.contactArr);
    }
    return undefined;
  }

  deleteContact(aContact) {
    if (aContact) {
      const thisMemContact = this.getContact(aContact.id);
      if (thisMemContact) {
        const idx = this.contactArr.indexOf(thisMemContact);
        const deletingActiveContact = (thisMemContact.id === this.activeContact.id);

        if (idx !== -1) {
          const newContactArr = this.contactArr.slice();
          newContactArr.splice(idx, 1);

          if (deletingActiveContact) {
            if (newContactArr.length > 0) {
              this.activeContact = newContactArr[0];
            } else {
              this.activeContact = undefined;
            }
          }

          this.contactArr = newContactArr;
        }
      }
    }
  }

  hasPublicKey(aContact = this.activeContact) {
    if (aContact) {
      return (aContact.publicKey) ? (aContact.publicKey !== '') : false;
    }
  }

  getPublicKey(aContactId) {
    if (aContactId) {
      const contact =
        ContactManager._getContactForId(aContactId, this.contactArr);

      if (contact) {
        return contact.publicKey;
      }
    }

    return '';
  }

  getTimeMs(aContactId) {
    if (aContactId) {
      const contact =
        ContactManager._getContactForId(aContactId, this.contactArr);

      if (contact &&
          contact.hasOwnProperty('timeMs')) {
        return contact.timeMs;
      }
    }

    return undefined;
  }

  setPublicKey(aContactId, aPublicKey) {
    this._setterWithChecks(aContactId, 'publicKey', aPublicKey);
  }

  setStatus(aContactId, aStatus) {
    this._setterWithChecks(aContactId, 'status', aStatus);
  }

  setSummary(aContactId, aSummaryStr) {
    const summaryStr = ContactManager._getTruncatedMessage(aSummaryStr);
    this._setterWithChecks(aContactId, 'summary', summaryStr);
  }

  setTime(aContactId, aTimeStr) {
    this._setterWithChecks(aContactId, 'time', aTimeStr);
  }

  setTimeMs(aContactId, theTimeSinceOnlineMs) {
    this._setterWithChecks(aContactId, 'timeMs', theTimeSinceOnlineMs);
  }

  incrementUnread(aContactId) {
    if (aContactId) {
      const contact =
        ContactManager._getContactForId(aContactId, this.contactArr);

      if (contact) {
        if (contact.hasOwnProperty('unread')) {
          contact.unread += 1;
        } else {
          contact.unread = 1;
        }
      }
    }
  }

  setUnread(aContactId, anUnreadCount) {
    this._setterWithChecks(aContactId, 'unread', anUnreadCount);
  }

  clearUnread(aContactId) {
    this._setterWithChecks(aContactId, 'unread', 0);
    document.title = "Stealthy | Decentralized Communication"
  }

  getAllUnread() {
    let unreadCount = 0;

    for (const contact of this.contactArr) {
      if (contact && contact.hasOwnProperty('unread')) {
        unreadCount += contact.unread;
      }
    }

    return unreadCount;
  }

  moveContactToTop(aContactId) {
    if (aContactId) {
      let index;
      for (index in this.contactArr) {
        if (aContactId === this.contactArr[index].id) {
          break;
        }
      }

      if ((index !== undefined) || (index !== 0)) {
        const contactToMoveToTop = this.contactArr.splice(index, 1);
        this.contactArr.splice(0, 0, contactToMoveToTop[0]);
      }
    }
  }

  _setterWithChecks(aContactId, aPropName, aValue) {
    if (aContactId && aPropName) {
      const contact = this.getContact(aContactId);

      if (contact) {
        contact[aPropName] = aValue;
      }
    }
  }

  static _getContactForId(aContactId, aContactArr) {
    for (const contact of aContactArr) {
      if (contact.id === aContactId) {
        return contact;
      }
    }
    return undefined;
  }

  static getContactTimeStr(aTimeInMs) {
    if (aTimeInMs && (aTimeInMs > 0)) {
      const timeInSeconds = Math.floor(aTimeInMs / 1000);
      const timeInMinutes = Math.floor(timeInSeconds / 60);
      const timeInHours = Math.floor(timeInMinutes / 60);
      const timeInDays = Math.floor(timeInHours / 24);
      if (timeInDays > 0) {
        return `present ${timeInDays} day(s) ago.`;
      } else if (timeInHours > 0) {
        return `present ${timeInHours} hour(s) ago.`;
      } else if (timeInMinutes > 1) {
        return `present ${timeInMinutes} minute(s) ago.`;
      }
      return 'available.';
    }

    return '...';
  }

  static _getTruncatedMessage(aMessageStr) {
    if (aMessageStr) {
      if (aMessageStr.length > SUMMARY_LEN) {
        return (`${aMessageStr.substring(0, SUMMARY_LEN)} ...`);
      }
      return aMessageStr;
    }
    return '';
  }

}

module.exports = { ContactManager };
