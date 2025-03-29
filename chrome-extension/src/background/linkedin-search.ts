/**
 * Utility to create LinkedIn search URLs directly from parameters
 */
export function createLinkedInSearchUrl(params: {
  query: string;
  location?: string;
  experienceLevel?: string;
  jobType?: string;
  datePosted?: string;
  remoteOption?: boolean;
}): string {
  // Build the LinkedIn URL with parameters
  const keywords = encodeURIComponent(params.query || 'jobs');
  const location = params.location ? `&location=${encodeURIComponent(params.location)}` : '';

  // Map experience level from text to LinkedIn's numeric codes
  let expLevel = '';
  if (params.experienceLevel) {
    const expMap: { [key: string]: string } = {
      'entry level': '1',
      associate: '2',
      'mid-senior level': '3',
      director: '4',
      executive: '5',
      // Map UI options to LinkedIn parameters
      internship: '1',
      'full-time': '3', // Map full-time to mid-senior as a default
    };
    const level = expMap[params.experienceLevel.toLowerCase()];
    if (level) expLevel = `&f_E=${level}`;
  }

  // Map job type to LinkedIn's format
  let jobType = '';
  if (params.jobType) {
    const jobMap: { [key: string]: string } = {
      'full-time': 'FULLTIME',
      'part-time': 'PARTTIME',
      contract: 'CONTRACT',
      internship: 'INTERNSHIP',
      temporary: 'TEMPORARY',
    };
    const type = jobMap[params.jobType.toLowerCase()];
    if (type) jobType = `&f_JT=${type}`;
  }

  // Add date posted filter if provided
  let datePosted = '';
  if (params.datePosted) {
    const dateMap: { [key: string]: string } = {
      past_24h: 'r86400',
      past_week: 'r604800',
      past_month: 'r2592000',
    };
    const date = dateMap[params.datePosted];
    if (date) datePosted = `&f_TPR=${date}`;
  }

  // Add remote filter if set
  const remote = params.remoteOption ? '&f_WT=2' : '';

  // Construct the full URL
  return `https://www.linkedin.com/jobs/search/?keywords=${keywords}${location}${expLevel}${jobType}${datePosted}${remote}`;
}
