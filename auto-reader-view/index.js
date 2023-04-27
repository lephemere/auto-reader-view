var buttons = require('sdk/ui/button/action');
var pageMod = require("sdk/page-mod");
var panels = require("sdk/panel");
var self = require("sdk/self");
var ss = require("sdk/simple-storage");
var tabs = require("sdk/tabs");
var uu = require("./lib/url-utils.js");

var ABOUT_READER_PREFIX = uu.ABOUT_READER_PREFIX;

var button = buttons.ActionButton({
  id: "auto-reader-view-link",
  label: "Auto Reader View",
  icon: {
    "16": "./miu-book-icon-16.png",
    "32": "./miu-book-icon-32.png",
    "64": "./miu-book-icon-64.png"
  },
  onClick: openPanel,
});

var tabPast = new Set();

var panel = panels.Panel({
  contentURL: self.data.url("panel.html"),
  height: 100,
  width: 250,
  contentScriptFile: self.data.url("panel.js")
});

// When tabs load check if the domain is enabled and if so, switch view.
tabs.on('load', function(tab) {
  console.log("tab load: " + tab.url);
  if (tab.url && isDomainEnabled(tab.url)) {
    console.log("Auto reader enabled for " + tab.url);
    setEnabledButtonState(button, tab);
    if (!uu.isUrlHomePage(tab.url)) {
      redirectToReaderView(tab);
    }
  }
  else {
    setDisabledButtonState(button, tab);
  }
});

// Send state for current tab when the button is clicked
function openPanel(btnState) {
  panel.port.emit("panelOpened", {
    enabled: isDomainEnabled(tabs.activeTab.url),
    domain: uu.domainFromUrl(tabs.activeTab.url)
  });
  panel.show({
    position: button
  });
}

// Save the preference when the enable/disable button is clicked
panel.port.on("domainChange", function(data) {
  console.log("change event received");
  console.log(data);
  if (data.enabled) {
    addDomain(data.domain);
    setEnabledButtonState(button, tabs.activeTab);
    if (!uu.isUrlHomePage(tabs.activeTab.url)) {
      redirectToReaderView(tabs.activeTab);
    }
  }
  else {
    removeDomain(data.domain);
    setDisabledButtonState(button, tabs.activeTab);
  }
});

function redirectToReaderView(tab) {
  console.log("Tab past: " + setToString(tabPast));
  var origUrl = tab.url;

  // Detect user exiting reader view temporarily, don't do a redirect
  if (!origUrl.startsWith(ABOUT_READER_PREFIX) &&
      tabPast.has(ABOUT_READER_PREFIX + origUrl)) {
    console.log("Was already in Reader View, exit");
    tabPast.delete(ABOUT_READER_PREFIX + origUrl);
  }
  // Already in reader view or another about page
  else if (origUrl.startsWith("about:")) {
    // do nothing
  }
  // Redirect to reader view
  else {
    var newUrl = ABOUT_READER_PREFIX + tab.url;
    console.log("Setting new url to " + newUrl);
    tab.url = newUrl;
  }

  // Store the previous urls in order to detect reader view "exits"
  tabPast.add(tab.url);

  // Housekeeping to prevent unbounded memory use
  if (tabPast.size > 50) {
    // TODO use an LRU cache instead
    console.log("tabPast size is " + tabPast.size + ". Clearing entries.");
    freeCache(tabPast, 5);
  }
  console.log("New tab past: " + setToString(tabPast));
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

// Add a checkmark badge to indicate the reader view is enabled
function setEnabledButtonState(button, tab, panel) {
  button.state(tab, {
    "badge" : "✓",
    "badgeColor" : "green"
  });
}

// Clear the badge
function setDisabledButtonState(button, tab) {
  button.state(tab, {
    badge : "",
    badgeColor : ""
  });
}

// Check storage for the domain
function isDomainEnabled(url) {
  initStorage();
  var domain = uu.domainFromUrl(url);
  return ss.storage.domains.indexOf(domain) != -1;
}

// Add a domain to storage
function addDomain(domain) {
  initStorage();
  console.log("Adding domain " + domain);
  ss.storage.domains.push(domain);
  console.log("Stored domains:");
  console.log(ss.storage.domains);
}

// Remove a domain from storage
function removeDomain(domain) {
  initStorage();
  console.log("Removing domain " + domain);
  var i = ss.storage.domains.indexOf(domain);
  delete ss.storage.domains[i];
  console.log(ss.storage.domains);
}

// Initialize storage if not already done so.
function initStorage() {
  if (!ss.storage.domains) {
    ss.storage.domains = [];
  }
}
