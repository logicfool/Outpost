import React, { createContext, useContext } from 'react';
import type { Catalog } from '../core/types';

const Revision = createContext('');
const revisionKey = (catalog: Catalog) =>
  `${catalog.sourceVersion ?? ''}:${catalog.metadataUpdatedAt ?? catalog.fetchedAt}`;

/** Retry previously failed image URLs after metadata is actually refreshed, not on version probes. */
export function ArtworkRevisionProvider({
  catalog,
  children,
}: {
  catalog: Catalog;
  children: React.ReactNode;
}) {
  return <Revision.Provider value={revisionKey(catalog)}>{children}</Revision.Provider>;
}
export function useArtworkRevision(catalog?: Catalog): string {
  const shared = useContext(Revision);
  return catalog ? revisionKey(catalog) : shared;
}
