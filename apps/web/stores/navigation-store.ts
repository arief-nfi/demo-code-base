import { create } from 'zustand';
import type { NavGroup } from '@/config/navigation';

interface NavigationState {
  navGroups: NavGroup[];
  setNavGroups: (groups: NavGroup[]) => void;
}

export const useNavigationStore = create<NavigationState>()((set) => ({
  navGroups: [],
  setNavGroups: (groups) => set({ navGroups: groups }),
}));
