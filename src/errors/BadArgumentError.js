class BadArgumentError extends TypeError {

  constructor(argumentName, argumentValue) {
    const message = argumentName && `Bad argument: \`${argumentName}\``;
    super(message || "Bad argument.");
    this.argumentName = argumentName;
    this.argumentValue = argumentValue;
  }

}

module.exports = BadArgumentError;