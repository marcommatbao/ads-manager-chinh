import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Platform, Improvement, ImprovementStatus, Priority } from "@/types/improvements";

interface ImprovementsState {
  items: Improvement[];
  loading: boolean;
  platformFilter: Platform | "ALL";
  statusFilter: ImprovementStatus | "ALL";
  sortBy: "priority" | "impact" | "confidence";
  collapsedGroups: Record<string, boolean>;
  justApplied: Set<string>;
  /** "keywords" = the real-data "Từ khóa" analysis view added alongside
   *  the existing card/queue view — separate fetch/shape (KeywordInsight[],
   *  not Improvement[]), owned by KeywordsView, not this store's `items`. */
  viewMode: "cards" | "keywords";
}

interface ImprovementsActions {
  setItems: (items: Improvement[]) => void;
  setLoading: (loading: boolean) => void;
  setPlatformFilter: (platform: Platform | "ALL") => void;
  setStatusFilter: (status: ImprovementStatus | "ALL") => void;
  setSortBy: (sort: "priority" | "impact" | "confidence") => void;
  toggleGroup: (groupId: string) => void;
  addJustApplied: (id: string) => void;
  removeJustApplied: (id: string) => void;
  updateItemStatus: (id: string, status: ImprovementStatus) => void;
  setViewMode: (mode: "cards" | "keywords") => void;
}

const initialState: ImprovementsState = {
  items: [],
  loading: false,
  platformFilter: "ALL",
  statusFilter: "ACTIVE",
  sortBy: "priority",
  collapsedGroups: {},
  justApplied: new Set(),
  viewMode: "cards",
};

export const useImprovementsStore = create<ImprovementsState & ImprovementsActions>()(
  immer((set, get) => ({
    ...initialState,

    setItems: (items) => {
      // Always reset just applied when new items load normally if we want, or keep it.
      // For now we just set items.
      set((state) => {
        state.items = items as any; // immer typing workaround for strict types
      });
    },
    setLoading: (loading) =>
      set((state) => {
        state.loading = loading;
      }),
    setPlatformFilter: (platform) =>
      set((state) => {
        state.platformFilter = platform;
      }),
    setStatusFilter: (status) =>
      set((state) => {
        state.statusFilter = status;
      }),
    setSortBy: (sort) =>
      set((state) => {
        state.sortBy = sort;
      }),
    toggleGroup: (groupId) =>
      set((state) => {
        state.collapsedGroups[groupId] = !state.collapsedGroups[groupId];
      }),
    addJustApplied: (id) =>
      set((state) => {
        const nextSet = new Set(state.justApplied);
        nextSet.add(id);
        state.justApplied = nextSet;
      }),
    removeJustApplied: (id) =>
      set((state) => {
        const nextSet = new Set(state.justApplied);
        nextSet.delete(id);
        state.justApplied = nextSet;
      }),
    updateItemStatus: (id, status) =>
      set((state) => {
        const item = state.items.find((i) => i.id === id);
        if (item) item.status = status;
      }),
    setViewMode: (mode) =>
      set((state) => {
        state.viewMode = mode;
      }),
  }))
);

// Helper selectors
export const selectFilteredItems = (state: ImprovementsState & ImprovementsActions) => {
  return state.items.filter((item) => {
    const matchPlatform = state.platformFilter === "ALL" || item.platform === state.platformFilter;
    const matchStatus = state.statusFilter === "ALL" || (item.status || "ACTIVE") === state.statusFilter;
    return matchPlatform && matchStatus;
  });
};

export const selectCountByPlatform = (state: ImprovementsState & ImprovementsActions) => {
  return {
    all: state.items.filter((i) => (i.status || "ACTIVE") === "ACTIVE").length,
    facebook: state.items.filter(
      (i) => i.platform === "FACEBOOK" && (i.status || "ACTIVE") === "ACTIVE"
    ).length,
    google: state.items.filter(
      (i) => i.platform === "GOOGLE" && (i.status || "ACTIVE") === "ACTIVE"
    ).length,
  };
};

export const selectAutoApplyItems = (state: ImprovementsState & ImprovementsActions) => {
  const base = state.items.filter(
    (i) => i.priority === "HIGH" && (i.status || "ACTIVE") === "ACTIVE" && i.canAutoApply
  );
  if (state.platformFilter === "ALL") return base;
  return base.filter((i) => i.platform === state.platformFilter);
};

export const selectGroupedByPriority = (
  state: ImprovementsState & ImprovementsActions,
  platform: Platform | "ALL"
) => {
  const items = selectFilteredItems(state).filter(
    (i) => platform === "ALL" || i.platform === platform
  );
  return {
    HIGH: items.filter((i) => i.priority === "HIGH"),
    MEDIUM: items.filter((i) => i.priority === "MEDIUM"),
    LOW: items.filter((i) => i.priority === "LOW"),
  };
};
