import { createHash } from 'node:crypto';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Eventarc list responses do not guarantee the order of conjunctive event filters.
// Match the retained original checksum by permuting only that unordered field.
export function matchesPreviousFunctionConfiguration(expectedHash, configuration) {
  if (hash(configuration) === expectedHash) return true;
  const filters = configuration.eventTrigger?.eventFilters;
  if (!Array.isArray(filters) || filters.length > 5) return false;
  const permutations = values => values.length ? values.flatMap((value, index) =>
    permutations(values.filter((_, i) => i !== index)).map(rest => [value, ...rest])) : [[]];
  return permutations(filters).some(eventFilters => hash({ ...configuration,
    eventTrigger: { ...configuration.eventTrigger, eventFilters } }) === expectedHash);
}

export function servesExpectedChartRevision(service, revision) {
  const name = value => typeof value === 'string' ? value.split('/').at(-1) : '';
  return name(service?.latestReadyRevision) === revision &&
    service.trafficStatuses?.some(traffic => name(traffic.revision) === revision && traffic.percent === 100) === true;
}
