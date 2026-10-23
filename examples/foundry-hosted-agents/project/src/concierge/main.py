from agent_framework_foundry_hosting import ResponsesHostServer
from dotenv import load_dotenv

from concierge.workflow import create_concierge

load_dotenv()


def main():
    # A factory, so every request gets its own workflow and the host restores its checkpoint.
    ResponsesHostServer(create_concierge).run()


if __name__ == "__main__":
    main()
