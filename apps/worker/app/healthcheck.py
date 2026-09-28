from sqlalchemy import create_engine, text

from app.config import database_url

engine = create_engine(database_url, pool_pre_ping=True)
with engine.connect() as connection:
    connection.execute(text("SELECT 1"))
