declare global {
  type ID = string;

  type PaginatedResponse<T> = {
    limit: number;
    offset: number;
    page: number;
    totalPages: number;
    hasPrevPage: boolean;
    hasNextPage: boolean;
    prevPage?: number;
    nextPage?: number;
    totalData: number;
    data: T[];
  };

  type BaseResponse = {
    id: ID;
    createdAt: string;
    updatedAt: string;
  };

  type QueryParams = {
    limit: number;
    page: number;
    search?: string;
    sortBy?: string[];
    filter?: string[];
  };
}

export {};
