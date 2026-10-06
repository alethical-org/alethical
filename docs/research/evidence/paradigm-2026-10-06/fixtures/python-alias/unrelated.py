class Other:
    def amount(self, row):
        return 10
def other_report(row):
    return Other().amount(row)
