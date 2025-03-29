export interface DirectLinkedInSearchMessage {
  type: 'direct_linkedin_search';
  params: {
    query: string;
    location?: string;
    experienceLevel?: string;
    jobType?: string;
    datePosted?: string;
    remoteOption?: boolean;
  };
  tabId: number;
}

export type Message = YourExistingMessageType | AnotherExistingMessageType | DirectLinkedInSearchMessage;
