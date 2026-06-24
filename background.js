'use strict';

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') + '?tab=1' });
});
