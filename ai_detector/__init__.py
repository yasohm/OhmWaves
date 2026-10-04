"""
OhmWaves' AI-music detector: tells AI-generated songs (Suno, Udio, ...) from human-made ones by their sound.

AI song generators turn their internal representation back into audio with upsampling ("deconvolution") layers,
which leave small, regularly spaced peaks in the frequency spectrum: a "fakeprint". We measure that spectrum on a
clip of each song and a small logistic-regression model, trained on our own labelled YouTube data, scores it.

- features.py        audio → fakeprint vector
- audio.py           YouTube track → 16 kHz mono clip (downloads only the first ~2 MB)
- model.py           the trained model (numpy only, so the server needs no ML libraries)
- sources.py         where the labelled training songs come from
- build_dataset.py   collect training data          python -m ai_detector.build_dataset
- train.py           train and evaluate the model   python -m ai_detector.train
"""
