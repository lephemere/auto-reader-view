// Track previous tab URLs
var tabPast = new Set();

/*
 * Updates the browserAction icon.
 */
function updateIcon(enabled) {
  console.log("Updating icon");
  if (enabled) {
    browser.browserAction.setBadgeText({ text: "✓" });
    browser.browserAction.setBadgeBackgroundColor({ color: "green" });
  } else {
    browser.browserAction.setBadgeText({ text: "" });
    browser.browserAction.setBadgeBackgroundColor({ color: null });
  }
}

function handleMessage(msg) {
  console.log("received message", msg);
  if (msg.type == "domainState") {
    // Sent by the panel when it loads to determine the current domain
    // and its state.
    return browser.tabs
      .query({
        active: true,
        windowId: browser.windows.WINDOW_ID_CURRENT,
      })
      .then((tabs) => browser.tabs.get(tabs[0].id))
      .then((tab) => {
        if (isNonReaderAboutPage(tab.url)) {
          return { valid: false };
        }
        var domain = domainFromUrl(tab.url);
        console.log(`Checking enabled status for ${domain}`);
        return isDomainEnabled(domain).then((enabled) => {
          updateIcon(enabled);
          return { enabled: enabled, domain: domain, valid: true };
        });
      });
  } else if (msg.type == "domainChange") {
    // Sent by the panel to indicate the new state of the given domain.
    browser.tabs
      .query({
        active: true,
        windowId: browser.windows.WINDOW_ID_CURRENT,
      })
      .then((tabs) => browser.tabs.get(tabs[0].id))
      .then((tab) => {
        if (msg.enabled) {
          addDomain(msg.domain);
          tryToggleReaderView(tab);
        } else {
          removeDomain(msg.domain);
        }
        updateIcon(msg.enabled);
      });
  }
}

function handleTabSwitch(activeInfo) {
  console.log(`Tab ${activeInfo.tabId} was activated`);
  if (activeInfo.tabId) {
    return browser.tabs.get(activeInfo.tabId).then((tab) => {
      var domain = domainFromUrl(tab.url);
      console.log(`Checking enabled status for ${domain}`);
      return isDomainEnabled(domain).then((enabled) => {
        updateIcon(enabled);
        return enabled;
      });
    });
  }
}

// Check storage for the domain
// @return {Promise<Boolean>}
function isDomainEnabled(domain) {
  return getStorage()
    .get("enabledDomains")
    .then((domains) => {
      console.log("Enabled domains are:", domains.enabledDomains);
      var isEnabled = domains.enabledDomains.indexOf(domain) >= 0;
      console.log(`${domain} enabled: ${isEnabled}`);
      return isEnabled;
    });
}

// Add a domain to storage
function addDomain(domain) {
  console.log("Adding domain ", domain);
  getStorage()
    .get("enabledDomains")
    .then((domains) => {
      console.log("retrieved domains", domains);
      let idx = domains.enabledDomains.indexOf(domain);
      if (idx === -1) {
        domains.enabledDomains.push(domain);
      }
      getStorage().set({ enabledDomains: domains.enabledDomains });
      console.log("Stored domains:", domains.enabledDomains);
    });
}

// Remove a domain from storage
function removeDomain(domain) {
  console.log("Removing domain ", domain);
  getStorage()
    .get("enabledDomains")
    .then((domains) => {
      console.log("retrieved domains", domains);
      let idx = domains.enabledDomains.indexOf(domain);
      if (idx > -1) {
        delete domains.enabledDomains[idx];
      }
      domains.enabledDomains = domains.enabledDomains.filter(Boolean);
      getStorage().set({ enabledDomains: domains.enabledDomains });
      console.log("Updated domains:", domains.enabledDomains);
    });
}

function saveDomainsList(domainsList) {
  console.log("Saving domains list", domainsList);
  getStorage().set({"enabledDomains": domainsList});
  console.log("Saved domains list")
}

function getStorage() {
  return browser.storage.local;
}

// Initialize storage if not already done so.
// @return {Promise}
function initStorage() {
  return getStorage()
    .get("enabledDomains")
    .then((domains) => {
      if (isObjectEmpty(domains)) {
        console.log("Initializing storage");
        store.set({ enabledDomains: new Array() });
      } else {
        console.log("Storage already intialized");
      }
    });
}

function isObjectEmpty(obj) {
  return Object.keys(obj).length === 0;
}

// Extract domain from a url
function domainFromUrl(url) {
  url = readerToNormalUrl(url);
  var r = /:\/\/(.[^/]+)/;
  var matches = url.match(r);
  if (matches && matches.length >= 2) {
    return matches[1];
  }
  return null;
}

function handleTabUpdate(tabId, changeInfo, tab) {
  // console.log(`Handling tab update for tab ${tabId} ${tab.url}, status: ${changeInfo.status}`, changeInfo);
  if ((changeInfo && changeInfo.isArticle) || (tab && tab.isArticle)) {
    var domain = domainFromUrl(tab.url);
    console.log(`Domain for updated tab ${tab.id} is ${domain}`);
    isDomainEnabled(domain).then((isEnabled) => {
      updateIcon(isEnabled);
      if (isEnabled) {
        console.log(`Auto reader enabled for ${domain}`);
        tryToggleReaderView(tab);
      }
    });
  }
}

function tryToggleReaderView(tab) {
  // Detect user exiting reader view temporarily, don't toggle back
  if (!tab.isInReaderMode && tabPast.has(normalToReaderUrl(tab.url))) {
    console.log("Was previously in Reader View");
    tabPast.delete(normalToReaderUrl(tab.url));
  }
  // Already in reader view
  else if (tab.isInReaderMode) {
    // do nothing
  } else {
    console.log(`Toggling reader mode for ${tab.id} ${tab.url} (isArticle? ${tab.isArticle})`);
    browser.tabs.toggleReaderMode(tab.id).catch(onError);
  }

  // Store the previous urls in order to detect reader view "exits"
  tabPast.add(normalToReaderUrl(tab.url));

  // Housekeeping to prevent unbounded memory use
  if (tabPast.size > 50) {
    // TODO use an LRU cache instead
    console.log(`tabPast size is ${tabPast.size}. Clearing entries.`);
    freeCache(tabPast, 5);
  }
  console.log("New tab past: ", setToString(tabPast));
}

function freeCache(set, numToRemove) {
  // remove least recently inserted entries
  // TODO use an LRU cache instead
  var iter = tabPast.values();
  for (var i = 0; i < numToRemove; i++) {
    var val = iter.next().value;
    set.delete(val);
  }
}

// No built-in pretty printing for Set :(
function setToString(s) {
  return JSON.stringify([...tabPast]);
}

function normalToReaderUrl(url) {
  if (!url.startsWith("about:reader")) {
    return "about:reader?url=" + encodeURIComponent(url);
  }
  return url;
}

function readerToNormalUrl(url) {
  if (url.startsWith("about:reader")) {
    let url = url.substr("about:reader?url=".length);
    return decodeURIComponent(url);
  }
  return url;
}

function isNonReaderAboutPage(url) {
  return url.startsWith("about:") && !url.startsWith("about:reader");
}

function isUrlHomePage(url) {
  var domain = domainFromUrl(url);
  var endOfDomainPartIdx = url.indexOf(domain) + domain.length;
  var pathPart = url.substr(endOfDomainPartIdx);
  return pathPart.length < 2; // 2 in case of trailing '/'
}

function onError(err) {
  console.log(err);
}

console.log("background script started");

updateIcon();
initStorage().then(() => {
  // Listen to messages sent from the panel
  browser.runtime.onMessage.addListener(handleMessage);

  // Listen to tab URL changes
  browser.tabs.onUpdated.addListener(handleTabUpdate);

  // listen to tab switching
  browser.tabs.onActivated.addListener(handleTabSwitch);

  // listen for window switching
  browser.windows.onFocusChanged.addListener(handleTabSwitch);
});
