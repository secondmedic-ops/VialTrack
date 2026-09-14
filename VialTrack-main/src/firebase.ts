import {
  db,
  auth,
  app,
  resolvedFirebaseConfig,
  resolvedFirestoreDatabaseId,
  CloudSync,
  seedCoreCollectionsIfEmpty,
  cleanupFirestoreCollections
} from './services/firebase';

export {
  db,
  auth,
  app,
  resolvedFirebaseConfig,
  resolvedFirestoreDatabaseId,
  CloudSync,
  seedCoreCollectionsIfEmpty,
  cleanupFirestoreCollections
};

export default db;
