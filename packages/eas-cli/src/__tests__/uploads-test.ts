import { fixS3Url } from '../uploads';

describe(fixS3Url, () => {
  it('fixes broken links', () => {
    const input =
      'https://submission-service-archives.s3.amazonaws.com/production%2Fdc98ca84-1473-4cb3-ae81-8c7b291cb27e%2F4424aa95-b985-4e2f-8755-9507b1037c1c';
    const expectedOutput =
      'https://submission-service-archives.s3.amazonaws.com/production/dc98ca84-1473-4cb3-ae81-8c7b291cb27e/4424aa95-b985-4e2f-8755-9507b1037c1c';
    expect(fixS3Url(input)).toBe(expectedOutput);
  });

  it('does not change correct urls', () => {
    const correctUrl =
      'https://submission-service-archives.s3.amazonaws.com/production/dc98ca84-1473-4cb3-ae81-8c7b291cb27e/4424aa95-b985-4e2f-8755-9507b1037c1c';
    expect(fixS3Url(correctUrl)).toBe(correctUrl);
  });
});
