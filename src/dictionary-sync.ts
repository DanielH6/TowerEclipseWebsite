import type {
  BugReport,
  Dictionaries,
  DictionaryName,
  DictionarySnapshot,
} from "./types";

const reportDictionaryFields: ReadonlyArray<[
  keyof Pick<BugReport, "status" | "version" | "priority" | "category" | "type" | "device">,
  DictionaryName,
]> = [
  ["status", "statuses"],
  ["version", "versions"],
  ["priority", "priorities"],
  ["category", "categories"],
  ["type", "types"],
  ["device", "devices"],
];

export function resolveDictionarySnapshot(
  savedValue: DictionarySnapshot,
  dictionary: DictionaryName,
  dictionaries: Dictionaries | null,
): DictionarySnapshot {
  const currentValue = dictionaries?.[dictionary].find(
    (entry) => entry.id === savedValue.id,
  );

  if (!currentValue) return savedValue;

  return {
    id: currentValue.id,
    code: currentValue.code,
    label: currentValue.label,
    color: currentValue.color,
    ...(currentValue.initial !== undefined
      ? { initial: currentValue.initial }
      : {}),
    ...(currentValue.terminal !== undefined
      ? { terminal: currentValue.terminal }
      : {}),
  };
}

export function synchronizeReportDictionaries(
  report: BugReport,
  dictionaries: Dictionaries | null,
): BugReport {
  if (!dictionaries) return report;

  const synchronized = { ...report };

  for (const [field, dictionary] of reportDictionaryFields) {
    synchronized[field] = resolveDictionarySnapshot(
      report[field],
      dictionary,
      dictionaries,
    );
  }

  return synchronized;
}
