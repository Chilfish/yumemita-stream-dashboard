import { createContext, useContext } from "react";
import type { GroupData } from "@/lib/group";

export const GroupDataContext = createContext<GroupData | null>(null);

export function useGroupDataContext(): GroupData {
  const value = useContext(GroupDataContext);
  if (!value) {
    throw new Error("useGroupDataContext must be used within GroupDataContext.Provider");
  }
  return value;
}
