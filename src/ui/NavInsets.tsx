import { createContext, useContext } from 'react';
export const NavInsetContext = createContext(0);
export function useNavInset() {
  return useContext(NavInsetContext);
}
