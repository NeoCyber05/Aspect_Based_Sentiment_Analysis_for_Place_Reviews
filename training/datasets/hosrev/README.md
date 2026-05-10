# HosRev Dataset

HosRev is a Vietnamese hospital review dataset for Aspect-Category Sentiment Analysis (ACSA). The data contains reviews of hospitals in Ho Chi Minh City with aspect-category sentiment labels.



## Model CSV Format

The model-ready CSV files use a wide format:

```csv
Review,Cơ sở vật chất#Chất lượng,...,Trải nghiệm chung#Vệ sinh
```

Each aspect-category column stores an integer label:

- `0`: aspect not mentioned
- `1`: positive
- `2`: negative
- `3`: neutral

## Splits

- `train.csv`: 4,566 samples
- `validation.csv`: 978 samples
- `test.csv`: 979 samples
