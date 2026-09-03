import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { api, setToken, getToken, apiError } from "@/lib/api";
import { flushOutbox, outboxCount, cacheGet, cacheSet } from "@/lib/db";
import { firebaseSignOut, signInWithEmail, signUpWithEmail, auth, refreshClaims } from "@/lib/firebase";
import { bootstrapAccount } from "@/lib/firebaseApi";
import { getFirestore, collection, query, where, limit as fbLimit, getDocs } from "firebase/firestore";
import { toast } from "sonner";

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

const PERMS = {
  Owner: ["*"],
  Manager: ["products", "inventory", "billing", "purchases", "sales", "customers", "suppliers", "returns", "reports", "labels", "importexport", "activity", "price_permanent", "stock_adjust", "void_bill"],
  Cashier: ["billing", "customers", "sales"],
  Staff: ["billing"],
};

export const FALLBACK_UNITS = ["Piece", "Pair", "Box", "Pack", "Dozen", "Kg", "Gram", "Litre", "Meter", "Bottle", "Set", "Other"];

export const AppProvider = ({ children }) => {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [shop, setShop] = useState(null);
  const [settings, setSettings] = useState(null);
  const [license, setLicense] = useState(null);
  const [meta, setMeta] = useState(null);          // business types / units / template
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);
  const [tick, setTick] = useState(0);
  const flushing = useRef(false);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const loadShop = useCallback(async () => {
    try {
      if (!auth?.currentUser) throw new Error("Not signed in");
      const db = getFirestore(auth.app);
      const token = await auth.currentUser.getIdTokenResult();
      const shopId = token.claims.shopId;
      if (!shopId) throw new Error("Shop is not linked to this account");

      const shopSnap = await getDocs(query(collection(db, "shops"), where("id", "==", shopId), fbLimit(1)));
      const shopData = shopSnap.docs[0]?.data();
      const settingsSnap = await getDocs(query(collection(db, "settings"), where("shopId", "==", shopId), fbLimit(1)));
      const settingsData = settingsSnap.docs[0]?.data() || {};
      const licenseSnap = await getDocs(query(collection(db, "licenses"), where("shopId", "==", shopId), fbLimit(1)));
      const licenseData = licenseSnap.docs[0]?.data() || null;

      setShop(shopData || null);
      setSettings({ ...shopData, ...settingsData });
      setLicense(licenseData);
      await cacheSet("shopMeta", { shop: shopData, settings: { ...shopData, ...settingsData }, license: licenseData });
    } catch (e) {
      console.log("[v0] Firestore shop load failed", e?.message || e);
      const cached = await cacheGet("shopMeta");
      if (cached) { setShop(cached.shop); setSettings(cached.settings); setLicense(cached.license || null); }
    }
    try {
      const cached = await cacheGet("templates");
      if (cached) setMeta(cached);
    } catch (e) {
      console.log("[v0] Template cache load failed", e?.message || e);
    }
  }, []);

  const boot = useCallback(async () => {
    try {
      if (auth?.currentUser) {
        await afterAuth(auth.currentUser);
      } else {
        setToken("");
      }
    } catch (e) {
      console.log("[v0] Firebase boot failed", e?.message || e);
      setToken("");
      setUser(null);
      setShop(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => { boot(); }, [boot]);

  const sync = useCallback(async () => {
    if (flushing.current || !navigator.onLine || !getToken()) return;
    flushing.current = true;
    try {
      const sent = await flushOutbox();
      if (sent) {
        toast.success(`${sent} offline bill(s) synced to cloud`);
        refresh();
      }
      setPending(await outboxCount());
    } finally {
      flushing.current = false;
    }
  }, [refresh]);

  useEffect(() => {
    const on = () => { setOnline(true); sync(); };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    outboxCount().then(setPending);
    sync();
    const t = setInterval(() => { if (navigator.onLine) { sync(); setTick((x) => x + 1); } }, 20000);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      clearInterval(t);
    };
  }, [sync]);

  const afterAuth = async (firebaseUser, options = {}) => {
    const token = await firebaseUser.getIdToken();
    setToken(token);
    const data = await bootstrapAccount(options);
    setUser(data.user || { uid: firebaseUser.uid, email: firebaseUser.email, role: data.role || "Owner" });
    setShop(data.shop || null);
    // Firebase bootstrap returns the authoritative shop/settings/license data.
    // Do not call the retired REST `/shop` endpoint here; the SPA fallback responds 405.
    if (data.settings) setSettings({ ...data.shop, ...data.settings });
    if (data.license) setLicense(data.license);
    return data;
  };

  const login = async (email, password) => {
    const firebaseUser = await signInWithEmail(email, password);
    const data = await afterAuth(firebaseUser);
    return { admin: data.user?.platformRole === "superadmin" || data.role === "superadmin" };
  };

  const signupShop = async (payload) => {
    const firebaseUser = await signUpWithEmail(payload.email, payload.password);
    return afterAuth(firebaseUser, {
      businessName: payload.businessName,
      businessType: payload.businessType,
      device: "web",
    });
  };

  const loginWithGoogle = async (idToken, businessName = "", businessType = "General Retail") => {
    if (!auth?.currentUser) throw new Error("Google sign-in session expired. Please try again.");
    const data = await afterAuth(auth.currentUser, { businessName, businessType, device: "web" });
    return data;
  };

  const logout = async () => {
    await firebaseSignOut();
    setToken("");
    setUser(null);
    setShop(null);
  };

  const can = (perm) => {
    if (!user) return false;
    const list = PERMS[user.role] || [];
    return list.includes("*") || list.includes(perm);
  };

  const saveSettings = async (patch) => {
    const data = await api.put("/shop", patch);
    setShop(data.shop);
    setSettings({ ...data.shop, ...data.settings });
    await loadShop();
  };

  // business-type driven defaults (never restrictions)
  const template = meta?.template || { categories: { General: ["Items"] }, customFields: [], attributes: ["Size", "Color"], defaultUnit: "Piece" };
  const units = [...(meta?.units || FALLBACK_UNITS), ...(settings?.customUnits || [])];

  return (
    <AppCtx.Provider value={{ ready, user, shop, settings, license, meta, template, units, online, pending, tick, refresh, login, loginWithGoogle, signupShop, logout, can, saveSettings, loadShop, apiError, sync }}>
      {children}
    </AppCtx.Provider>
  );
};
