from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from firebase_admin import credentials, firestore, initialize_app
import openai
import os
import base64
import json

# Decode the FIREBASE_CREDENTIALS environment variable
firebase_creds = os.getenv("FIREBASE_CREDENTIALS")
if not firebase_creds:
    raise ValueError("Missing FIREBASE_CREDENTIALS environment variable")

decoded_creds = base64.b64decode(firebase_creds).decode("utf-8")
firebase_config = json.loads(decoded_creds)

# Initialize Firebase
cred = credentials.Certificate(firebase_config)
initialize_app(cred)
db = firestore.client()

# Initialize FastAPI app
app = FastAPI()

# OpenAI API Key (Store securely, not in code!)
openai.api_key = os.getenv("OPENAI_API_KEY")

class MealRequest(BaseModel):
    user_id: str
    cycle_day: int
    symptoms: str

@app.post("/generate_meal_plan/")
def generate_meal_plan(request: MealRequest):
    try:
        response = openai.Completion.create(
            engine="text-davinci-003",
            prompt=f"Generate a healthy meal plan for cycle day {request.cycle_day} with symptoms: {request.symptoms}",
            max_tokens=100
        )
        meal_plan = response["choices"][0]["text"].strip()

        # Save to Firebase
        meal_ref = db.collection("meal_plans").document(request.user_id)
        meal_ref.set({"cycle_day": request.cycle_day, "symptoms": request.symptoms, "meal_plan": meal_plan})

        return {"meal_plan": meal_plan}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/get_meal_plan/{user_id}")
def get_meal_plan(user_id: str):
    meal_ref = db.collection("meal_plans").document(user_id).get()
    if meal_ref.exists:
        return meal_ref.to_dict()
    else:
        raise HTTPException(status_code=404, detail="Meal plan not found")

