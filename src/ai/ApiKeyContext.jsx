import { createContext, useContext, useEffect, useMemo, useState } from "react";

const SESSION_STORAGE_KEY = "phasefuel_openai_api_key";

const ApiKeyContext = createContext({
  apiKey: "",
  setApiKey: () => {},
  clearApiKey: () => {},
  rememberInSession: false,
  setRememberInSession: () => {},
});

const getSessionApiKey = () => {
  if (typeof window === "undefined") {
    return "";
  }
  return window.sessionStorage.getItem(SESSION_STORAGE_KEY) || "";
};

export const ApiKeyProvider = ({ children }) => {
  const [apiKey, setApiKey] = useState(() => getSessionApiKey());
  const [rememberInSession, setRememberInSession] = useState(() => Boolean(getSessionApiKey()));

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (rememberInSession && apiKey) {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, apiKey);
      return;
    }

    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }, [apiKey, rememberInSession]);

  const clearApiKey = () => {
    setApiKey("");
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  };

  const value = useMemo(
    () => ({
      apiKey,
      setApiKey,
      clearApiKey,
      rememberInSession,
      setRememberInSession,
    }),
    [apiKey, rememberInSession]
  );

  return <ApiKeyContext.Provider value={value}>{children}</ApiKeyContext.Provider>;
};

export const useApiKey = () => useContext(ApiKeyContext);
