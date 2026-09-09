import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { Client, TaskItem, TaskStatus } from "./types";
import { SEED_CLIENTS } from "./seed";

const STORAGE_KEY = "cedra-clients-v1";

function loadClients(): Client[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Client[];
  } catch {
    // fall through to seed data
  }
  return SEED_CLIENTS;
}

interface DataContextValue {
  clients: Client[];
  addClient: (client: Omit<Client, "id" | "tasks"> & { tasks?: TaskItem[] }) => Client;
  updateClient: (id: string, patch: Partial<Client>) => void;
  deleteClient: (id: string) => void;
  updateTaskStatus: (clientId: string, taskId: string, status: TaskStatus) => void;
  resetToDemoData: () => void;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [clients, setClients] = useState<Client[]>(() => loadClients());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clients));
    } catch {
      // ignore quota / privacy-mode errors
    }
  }, [clients]);

  const addClient: DataContextValue["addClient"] = useCallback((client) => {
    const newClient: Client = {
      ...client,
      id: `client-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      tasks: client.tasks ?? [],
    };
    setClients((prev) => [newClient, ...prev]);
    return newClient;
  }, []);

  const updateClient: DataContextValue["updateClient"] = useCallback((id, patch) => {
    setClients((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const deleteClient: DataContextValue["deleteClient"] = useCallback((id) => {
    setClients((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const updateTaskStatus: DataContextValue["updateTaskStatus"] = useCallback(
    (clientId, taskId, status) => {
      setClients((prev) =>
        prev.map((c) =>
          c.id !== clientId
            ? c
            : {
                ...c,
                tasks: c.tasks.map((t) => (t.id === taskId ? { ...t, status } : t)),
              },
        ),
      );
    },
    [],
  );

  const resetToDemoData = useCallback(() => {
    setClients(SEED_CLIENTS);
  }, []);

  const value = useMemo(
    () => ({ clients, addClient, updateClient, deleteClient, updateTaskStatus, resetToDemoData }),
    [clients, addClient, updateClient, deleteClient, updateTaskStatus, resetToDemoData],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within a DataProvider");
  return ctx;
}
