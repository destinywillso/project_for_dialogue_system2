from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from rgm_inference import predict_contradiction


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],  
    allow_credentials=True,
    allow_methods=["*"],  
    allow_headers=["*"],   
)

class DialogInput(BaseModel):
    utterances: list
    annotation_target_pair: list

@app.post("/predict")
def predict(dialog: DialogInput):
    result = predict_contradiction(dialog.dict())
    return {"prediction": result}

#uvicorn app:app --reload
