export interface UploadResultName {
  fullName: string;
  name: string;
  id?: string;
}

export const uploadWorkerAsync = async (
  url: string,
  contents: BodyInit,
): Promise<UploadResultName> => {
  const response = await fetch(url, {
    method: 'POST',
    body: contents,
  });

  if (response.ok) {
    const json = await response.json();
    if (!json.success) {
      throw new Error(json.message ? `${json.message}` : 'Upload failed!');
    }
    return json.result;
  } else {
    throw new Error(`Upload failed! (${response.statusText})`);
  }
};
