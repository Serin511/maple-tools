export function getBasePath(pathname, pageIds) {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.at(-1) === 'index.html') segments.pop();
  if (pageIds.includes(segments.at(-1))) segments.pop();
  return `/${segments.length ? `${segments.join('/')}/` : ''}`;
}

export function pageFromPath(pathname, pageIds) {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.at(-1) === 'index.html') segments.pop();
  const candidate = segments.at(-1);
  return pageIds.includes(candidate) ? candidate : undefined;
}

export function pagePath(location, id, pageIds, search = location.search) {
  return `${getBasePath(location.pathname, pageIds)}${id}/${search}`;
}
