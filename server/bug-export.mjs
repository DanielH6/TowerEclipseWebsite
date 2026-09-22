export function filterBugReports(reports, query) {
    const search = typeof query.search === "string" ? query.search.trim().toLowerCase() : "";
    const filters = {
      status: requestedFilterValues(query.status),
      version: requestedFilterValues(query.version),
      priority: requestedFilterValues(query.priority),
      category: requestedFilterValues(query.category),
      type: requestedFilterValues(query.type),
      device: requestedFilterValues(query.device),
    };

    return reports.filter((report) => {
      if (report.submissionState === "uploading") return false;
      if (search) {
        const haystack = [
          report.displayId,
          report.description,
          report.reporter?.displayName,
          report.reporter?.username,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(search)) return false;
      }

      return Object.entries(filters).every(([field, codes]) => codes.size === 0 || codes.has(report[field]?.code));
    });

}

function requestedFilterValues(value) {
  const values = Array.isArray(value) ? value : [value];
  return new Set(values
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean));
}

