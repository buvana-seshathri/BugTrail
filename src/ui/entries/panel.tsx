import { App } from '../App';
import { mount } from './mount';

// The DevTools panel always investigates the tab DevTools is attached to.
mount(<App tabId={chrome.devtools.inspectedWindow.tabId} surface="devtools" />);
