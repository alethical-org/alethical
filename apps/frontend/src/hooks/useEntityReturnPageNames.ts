import { useEffect, useRef } from 'react';
import {
  forgetReturnPageName,
  rememberReturnPageName,
  rememberReturnPageAlias,
} from '../navigation/returnDestination';

/** Keep a served public identity and its requested alias together, including confirmed removal. */
export function useEntityReturnPageNames(
  requestedPath: string | null,
  servedPath: string | null,
  name: string | null | undefined,
  notFound: boolean,
) {
  const servedAliases = useRef(new Map<string, string>());
  useEffect(() => {
    if (!requestedPath) return;
    if (notFound) {
      forgetReturnPageName(requestedPath);
      const alias = servedAliases.current.get(requestedPath);
      if (alias) forgetReturnPageName(alias);
      servedAliases.current.delete(requestedPath);
      return;
    }
    if (servedPath && name) {
      rememberReturnPageName(requestedPath, name);
      rememberReturnPageName(servedPath, name);
      rememberReturnPageAlias(requestedPath, servedPath);
      servedAliases.current.set(requestedPath, servedPath);
      if (servedAliases.current.size > 200)
        servedAliases.current.delete(servedAliases.current.keys().next().value!);
    }
  }, [requestedPath, servedPath, name, notFound]);
}
