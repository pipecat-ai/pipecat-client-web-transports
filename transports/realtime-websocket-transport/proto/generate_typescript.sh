# Use this script to generate the typescript each time we change the frames.proto file
rm -rf ./src/generated/*
protoc \
  --ts_out=generate_dependencies:./src/generated \
  proto/frames.proto
