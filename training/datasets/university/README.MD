# Dataset Card for Vietnamese Students' Feedback Corpus

## Dataset Summary

Students' feedback is a vital resource for the interdisciplinary research involving the combining of two different research fields between sentiment analysis and education.

Vietnamese Students' Feedback Corpus (UIT-VSFC) is the resource consists of over 16,000 sentences which are human-annotated with two different tasks: sentiment-based and topic-based classifications.

## Data Fields

| Field | Type | Description |
|-------|------|-------------|
| sentence | str | Text sentence. |
| sentiment | int | Sentiment class: 0 (negative), 1 (neutral), 2 (positive) |
| topic | int | Topic class: 0 (lecturer), 1 (training_program), 2 (facility), 3 (others) |
