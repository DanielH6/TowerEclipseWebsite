import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";

interface LocationState {
  pathname: string;
  search: string;
  hash: string;
  state: unknown;
}

interface NavigateOptions {
  replace?: boolean;
  state?: unknown;
}

interface RouterContextValue {
  location: LocationState;
  navigate: (to: string, options?: NavigateOptions) => void;
}

const RouterContext = createContext<RouterContextValue | null>(null);
const ParamsContext = createContext<Record<string, string>>({});
const NAVIGATION_EVENT = "tower-eclipse:navigation";

function readLocation(): LocationState {
  return {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    state: window.history.state,
  };
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<LocationState>(() => readLocation());

  useEffect(() => {
    const update = () => setLocation(readLocation());
    window.addEventListener("popstate", update);
    window.addEventListener(NAVIGATION_EVENT, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(NAVIGATION_EVENT, update);
    };
  }, []);

  const navigate = useCallback((to: string, options: NavigateOptions = {}) => {
    const destination = new URL(to, window.location.origin);
    const path = `${destination.pathname}${destination.search}${destination.hash}`;
    if (options.replace) {
      window.history.replaceState(options.state ?? null, "", path);
    } else {
      window.history.pushState(options.state ?? null, "", path);
    }
    window.dispatchEvent(new Event(NAVIGATION_EVENT));
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  const value = useMemo(() => ({ location, navigate }), [location, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

function useRouter() {
  const value = useContext(RouterContext);
  if (!value) throw new Error("Router hooks must be used inside RouterProvider.");
  return value;
}

export function useLocation() {
  return useRouter().location;
}

export function useNavigate() {
  return useRouter().navigate;
}

export function RouteParamsProvider({
  params,
  children,
}: {
  params: Record<string, string>;
  children: ReactNode;
}) {
  return <ParamsContext.Provider value={params}>{children}</ParamsContext.Provider>;
}

export function useParams<T extends Record<string, string | undefined> = Record<string, string>>() {
  return useContext(ParamsContext) as T;
}

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  to: string;
  state?: unknown;
  replace?: boolean;
}

function shouldHandle(event: MouseEvent<HTMLAnchorElement>, target?: string) {
  return !event.defaultPrevented
    && event.button === 0
    && !event.metaKey
    && !event.ctrlKey
    && !event.shiftKey
    && !event.altKey
    && (!target || target === "_self");
}

export function Link({ to, state, replace, onClick, target, ...props }: LinkProps) {
  const navigate = useNavigate();
  return (
    <a
      {...props}
      href={to}
      target={target}
      onClick={(event) => {
        onClick?.(event);
        if (!shouldHandle(event, target)) return;
        const destination = new URL(to, window.location.origin);
        if (destination.origin !== window.location.origin) return;
        event.preventDefault();
        navigate(`${destination.pathname}${destination.search}${destination.hash}`, { replace, state });
      }}
    />
  );
}

interface NavLinkState {
  isActive: boolean;
}

interface NavLinkProps extends Omit<LinkProps, "className"> {
  className?: string | ((state: NavLinkState) => string | undefined);
  end?: boolean;
}

export function NavLink({ to, end = false, className, ...props }: NavLinkProps) {
  const { pathname } = useLocation();
  const targetPath = new URL(to, window.location.origin).pathname;
  const isActive = end
    ? pathname === targetPath
    : pathname === targetPath || (targetPath !== "/" && pathname.startsWith(`${targetPath}/`));
  const resolvedClassName = typeof className === "function" ? className({ isActive }) : className;
  return <Link {...props} to={to} className={resolvedClassName} />;
}

export function Navigate({
  to,
  replace = false,
  state,
}: {
  to: string;
  replace?: boolean;
  state?: unknown;
}) {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to, { replace, state });
  }, [navigate, replace, state, to]);
  return null;
}
