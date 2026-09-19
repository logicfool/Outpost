import { registerRootComponent } from 'expo';
import './src/platform/background';
import './src/platform/historySyncBackground';
import App from './App';
registerRootComponent(App);
