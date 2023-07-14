import {
  DanswerDocument,
  Quote,
  SearchRequestArgs,
  SearchType,
} from "./interfaces";

const processSingleChunk = (
  chunk: string,
  currPartialChunk: string | null
): [{ [key: string]: any } | null, string | null] => {
  const completeChunk = (currPartialChunk || "") + chunk;
  try {
    // every complete chunk should be valid JSON
    const chunkJson = JSON.parse(completeChunk);
    return [chunkJson, null];
  } catch (err) {
    // if it's not valid JSON, then it's probably an incomplete chunk
    return [null, completeChunk];
  }
};

const processRawChunkString = (
  rawChunkString: string,
  previousPartialChunk: string | null
): [any[], string | null] => {
  /* This is required because, in practice, we see that nginx does not send over
  each chunk one at a time even with buffering turned off. Instead,
  chunks are sometimes in batches or are sometimes incomplete */
  if (!rawChunkString) {
    return [[], null];
  }
  const chunkSections = rawChunkString
    .split("\n")
    .filter((chunk) => chunk.length > 0);
  let parsedChunkSections: any[] = [];
  let currPartialChunk = previousPartialChunk;
  chunkSections.forEach((chunk) => {
    const [processedChunk, partialChunk] = processSingleChunk(
      chunk,
      currPartialChunk
    );
    if (processedChunk) {
      parsedChunkSections.push(processedChunk);
      currPartialChunk = null;
    } else {
      currPartialChunk = partialChunk;
    }
  });

  return [parsedChunkSections, currPartialChunk];
};

export const searchRequestStreamed = async ({
  query,
  sources,
  updateCurrentAnswer,
  updateQuotes,
  updateDocs,
  updateSuggestedSearchType,
  updateSuggestedFlowType,
  selectedSearchType,
  offset,
}: SearchRequestArgs) => {
  let useKeyword = null;
  if (selectedSearchType !== SearchType.AUTOMATIC) {
    useKeyword = selectedSearchType === SearchType.KEYWORD ? true : false;
  }

  let answer = "";
  let quotes: Record<string, Quote> | null = null;
  let relevantDocuments: DanswerDocument[] | null = null;
  try {
    const response = await fetch("/api/stream-direct-qa", {
      method: "POST",
      body: JSON.stringify({
        query,
        collection: "danswer_index",
        use_keyword: useKeyword,
        ...(sources.length > 0
          ? {
              filters: [
                {
                  source_type: sources.map((source) => source.internalName),
                },
              ],
            }
          : {}),
        offset: offset,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });
    const reader = response.body?.getReader();
    const decoder = new TextDecoder("utf-8");

    let previousPartialChunk = null;
    while (true) {
      const rawChunk = await reader?.read();
      if (!rawChunk) {
        throw new Error("Unable to process chunk");
      }
      const { done, value } = rawChunk;
      if (done) {
        break;
      }

      // Process each chunk as it arrives
      const [completedChunks, partialChunk] = processRawChunkString(
        decoder.decode(value, { stream: true }),
        previousPartialChunk
      );
      if (!completedChunks.length && !partialChunk) {
        break;
      }
      previousPartialChunk = partialChunk;
      completedChunks.forEach((chunk) => {
        // TODO: clean up response / this logic
        const answerChunk = chunk.answer_data;
        if (answerChunk) {
          answer += answerChunk;
          updateCurrentAnswer(answer);
        } else if (chunk.answer_finished) {
          // set quotes as non-null to signify that the answer is finished and
          // we're now looking for quotes
          updateQuotes({});
          if (
            answer &&
            !answer.endsWith(".") &&
            !answer.endsWith("?") &&
            !answer.endsWith("!")
          ) {
            answer += ".";
            updateCurrentAnswer(answer);
          } else {
            updateCurrentAnswer("");
          }
        } else {
          if (Object.hasOwn(chunk, "top_documents")) {
            const docs = chunk.top_documents as any[] | null;
            if (docs) {
              relevantDocuments = docs.map(
                (doc) => JSON.parse(doc) as DanswerDocument
              );
              updateDocs(relevantDocuments);
            }

            if (chunk.predicted_flow) {
              updateSuggestedFlowType(chunk.predicted_flow);
            }
            if (chunk.predicted_search) {
              updateSuggestedSearchType(chunk.predicted_search);
            }
          } else {
            quotes = chunk as Record<string, Quote>;
            updateQuotes(quotes);
          }
        }
      });
    }
  } catch (err) {
    console.error("Fetch error:", err);
  }
  return { answer, quotes, relevantDocuments };
};
