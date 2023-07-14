"use client";

import { useRef, useState } from "react";
import { SearchBar } from "./SearchBar";
import { SearchResultsDisplay } from "./SearchResultsDisplay";
import { SourceSelector } from "./Filters";
import { Connector } from "@/lib/types";
import { SearchTypeSelector } from "./SearchTypeSelector";
import {
  DanswerDocument,
  Quote,
  SearchResponse,
  Source,
  FlowType,
  SearchType,
  SearchDefaultOverrides,
  SearchRequestOverrides,
} from "@/lib/search/interfaces";
import { searchRequestStreamed } from "@/lib/search/streamingQa";
import Cookies from "js-cookie";
import { SearchHelper } from "./SearchHelper";
import { CancellationToken, cancellable } from "@/lib/search/cancellable";
import { NEXT_PUBLIC_DISABLE_STREAMING } from "@/lib/constants";
import { searchRequest } from "@/lib/search/qa";

const SEARCH_DEFAULT_OVERRIDES_START: SearchDefaultOverrides = {
  forceDisplayQA: false,
  offset: 0,
};

interface SearchSectionProps {
  connectors: Connector<any>[];
  defaultSearchType: SearchType;
}

export const SearchSection: React.FC<SearchSectionProps> = ({
  connectors,
  defaultSearchType,
}) => {
  // Search Bar
  const [query, setQuery] = useState<string>("");

  // Search
  const [searchResponse, setSearchResponse] = useState<SearchResponse | null>(
    null
  );
  const [isFetching, setIsFetching] = useState(false);

  // Filters
  const [sources, setSources] = useState<Source[]>([]);

  // Search Type
  const [selectedSearchType, setSelectedSearchType] =
    useState<SearchType>(defaultSearchType);

  // Overrides for default behavior that only last a single query
  const [defaultOverrides, setDefaultOverrides] =
    useState<SearchDefaultOverrides>(SEARCH_DEFAULT_OVERRIDES_START);

  // Helpers
  const initialSearchResponse: SearchResponse = {
    answer: null,
    quotes: null,
    documents: null,
    suggestedSearchType: null,
    suggestedFlowType: null,
  };
  const updateCurrentAnswer = (answer: string) =>
    setSearchResponse((prevState) => ({
      ...(prevState || initialSearchResponse),
      answer,
    }));
  const updateQuotes = (quotes: Record<string, Quote>) =>
    setSearchResponse((prevState) => ({
      ...(prevState || initialSearchResponse),
      quotes,
    }));
  const updateDocs = (documents: DanswerDocument[]) =>
    setSearchResponse((prevState) => ({
      ...(prevState || initialSearchResponse),
      documents,
    }));
  const updateSuggestedSearchType = (suggestedSearchType: SearchType) =>
    setSearchResponse((prevState) => ({
      ...(prevState || initialSearchResponse),
      suggestedSearchType,
    }));
  const updateSuggestedFlowType = (suggestedFlowType: FlowType) =>
    setSearchResponse((prevState) => ({
      ...(prevState || initialSearchResponse),
      suggestedFlowType,
    }));

  let lastSearchCancellationToken = useRef<CancellationToken | null>(null);
  const onSearch = async ({
    searchType,
    offset,
  }: SearchRequestOverrides = {}) => {
    // cancel the prior search if it hasn't finished
    if (lastSearchCancellationToken.current) {
      lastSearchCancellationToken.current.cancel();
    }
    lastSearchCancellationToken.current = new CancellationToken();

    setIsFetching(true);
    setSearchResponse(initialSearchResponse);

    const searchFn = NEXT_PUBLIC_DISABLE_STREAMING
      ? searchRequest
      : searchRequestStreamed;
    await searchFn({
      query,
      sources,
      updateCurrentAnswer: cancellable({
        cancellationToken: lastSearchCancellationToken.current,
        fn: updateCurrentAnswer,
      }),
      updateQuotes: cancellable({
        cancellationToken: lastSearchCancellationToken.current,
        fn: updateQuotes,
      }),
      updateDocs: cancellable({
        cancellationToken: lastSearchCancellationToken.current,
        fn: updateDocs,
      }),
      updateSuggestedSearchType: cancellable({
        cancellationToken: lastSearchCancellationToken.current,
        fn: updateSuggestedSearchType,
      }),
      updateSuggestedFlowType: cancellable({
        cancellationToken: lastSearchCancellationToken.current,
        fn: updateSuggestedFlowType,
      }),
      selectedSearchType: searchType ?? selectedSearchType,
      offset: offset ?? defaultOverrides.offset,
    });

    setIsFetching(false);
  };

  return (
    <div className="relative max-w-[2000px] xl:max-w-[1400px] mx-auto">
      <div className="absolute left-0 hidden 2xl:block w-64">
        {connectors.length > 0 && (
          <SourceSelector
            selectedSources={sources}
            setSelectedSources={setSources}
            existingSources={connectors.map((connector) => connector.source)}
          />
        )}

        <div className="mt-10">
          <SearchHelper
            isFetching={isFetching}
            searchResponse={searchResponse}
            selectedSearchType={selectedSearchType}
            setSelectedSearchType={setSelectedSearchType}
            defaultOverrides={defaultOverrides}
            restartSearch={onSearch}
            forceQADisplay={() =>
              setDefaultOverrides((prevState) => ({
                ...(prevState || SEARCH_DEFAULT_OVERRIDES_START),
                forceDisplayQA: true,
              }))
            }
            setOffset={(offset) => {
              setDefaultOverrides((prevState) => ({
                ...(prevState || SEARCH_DEFAULT_OVERRIDES_START),
                offset,
              }));
            }}
          />
        </div>
      </div>
      <div className="w-[800px] mx-auto">
        <SearchTypeSelector
          selectedSearchType={selectedSearchType}
          setSelectedSearchType={(searchType) => {
            Cookies.set("searchType", searchType);
            setSelectedSearchType(searchType);
          }}
        />

        <SearchBar
          query={query}
          setQuery={setQuery}
          onSearch={async () => {
            setDefaultOverrides(SEARCH_DEFAULT_OVERRIDES_START);
            await onSearch({ offset: 0 });
          }}
        />

        <div className="mt-2">
          <SearchResultsDisplay
            searchResponse={searchResponse}
            isFetching={isFetching}
            defaultOverrides={defaultOverrides}
          />
        </div>
      </div>
    </div>
  );
};
