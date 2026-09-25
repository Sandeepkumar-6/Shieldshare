// Folder-name lookup over a useAsync(folderApi.list) result:
//   a name   → the folder exists
//   null     → folders are loaded and this one no longer exists
//   undefined→ folder names are not known yet (loading or failed)
export function folderLookup(folders) {
  return (id) => {
    if (folders.status !== 'success' || !id) return undefined;
    return folders.data.find((folder) => folder.id === id)?.name ?? null;
  };
}
