import { refreshBugReportCacheFromFirestore } from "../server/bug-routes.mjs";
import { refreshDictionaryCacheFromFirestore } from "../server/dictionaries.mjs";
import { localCacheDirectory } from "../server/local-cache.mjs";

console.log(`Refreshing local Firestore caches in ${localCacheDirectory()}...`);
await refreshDictionaryCacheFromFirestore();
await refreshBugReportCacheFromFirestore();
console.log("Dictionary cache refreshed and complete report database scan verified. Bug lists no longer use a disk cache.");
