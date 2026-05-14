from .configuration_absa import ABSAConfig
from .configuration_uni import UniVSFCConfig
from .modeling_absa import ABSAOutput, ABSAForAspectSentimentClassification
from .modeling_uni import UniVSFCForMultiTaskClassification, UniVSFCOutput
from transformers import AutoConfig, AutoModel, AutoModelForSequenceClassification

try:
    AutoConfig.register(ABSAConfig.model_type, ABSAConfig)
except ValueError:
    pass

try:
    AutoModel.register(ABSAConfig, ABSAForAspectSentimentClassification)
except ValueError:
    pass

try:
    AutoModelForSequenceClassification.register(ABSAConfig, ABSAForAspectSentimentClassification)
except ValueError:
    pass

try:
    AutoConfig.register(UniVSFCConfig.model_type, UniVSFCConfig)
except ValueError:
    pass

try:
    AutoModel.register(UniVSFCConfig, UniVSFCForMultiTaskClassification)
except ValueError:
    pass

try:
    AutoModelForSequenceClassification.register(UniVSFCConfig, UniVSFCForMultiTaskClassification)
except ValueError:
    pass

__all__ = [
    "ABSAConfig",
    "ABSAOutput",
    "ABSAForAspectSentimentClassification",
    "UniVSFCConfig",
    "UniVSFCForMultiTaskClassification",
    "UniVSFCOutput",
]
