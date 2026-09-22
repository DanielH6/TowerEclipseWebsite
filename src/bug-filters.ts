import type { BugFilters } from './api';
const fields = ['status', 'version', 'priority', 'category', 'type', 'device'] as const;
export function filtersFromSearch(search: string): BugFilters {
  const parameters = new URLSearchParams(search);
  return { search: parameters.get('search') ?? '', ...Object.fromEntries(fields.map(key => [key, parameters.getAll(key)])) };
}
export function filtersToSearch(filters: BugFilters): string {
  const parameters = new URLSearchParams();
  if (filters.search) parameters.set('search', filters.search);
  fields.forEach(key => filters[key]?.forEach(value => parameters.append(key, value)));
  return parameters.toString();
}
