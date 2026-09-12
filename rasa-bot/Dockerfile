FROM rasa/rasa:3.6.21

WORKDIR /app
COPY . /app

USER root
RUN rasa train
USER 1001

EXPOSE 5005
CMD ["run", "--enable-api", "--cors", "*", "--host", "0.0.0.0", "--port", "5005", "--endpoints", "endpoints.cloud.yml"]
